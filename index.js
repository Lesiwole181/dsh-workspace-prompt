/**
 * dsh-workspace-prompt — Host 半入口。
 *
 * 模块职责（只做组装，不写业务规则）：
 * 1. 组装 `host/*` 四个模块（提示词存储、启用开关、工作区解析、注入记录）；
 * 2. 注册系统提示词的运行时上下文 `workspace-prompt:current`：
 *    每次模型步骤重新求值、同步返回，提示词只进系统提示词，不产生任何对话行；
 * 3. 注册 7 条 `/api/workspacePrompt/*` 路由（浏览器半的数据面）：前 4 条是 PLAN 第 5.2 节的
 *    冻结契约（按 sessionId 定位），后 3 条供设置页使用（按 workspaceId 定位 + 无入参的全局最近注入）；
 * 4. 所有注册都用 `ctx.effect(() => disposer)` 挂着，插件卸载后不留任何东西；
 * 5. 零第三方依赖：只 import `node:` 内置模块。
 *
 * 服务依赖：用 `ctx.inject([...], callback)`（而不是顶层 `export const inject`）。
 * 顶层 inject 是硬依赖——四个服务缺一个插件就整体静默不激活，难以排查；
 * `ctx.inject` 让 `apply` 一定被调用，只在服务齐备后才注册，且注册随子 fiber 自动回收。
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as promptStore from './host/prompt-store.js'
import { createEnableStore } from './host/enable-store.js'
import { createInjectionRegistry } from './host/injection-registry.js'
import { createWorkspaceResolver } from './host/workspace-resolver.js'
import { createRoutes } from './host/api-routes.js'

/** 插件包根目录（本文件即包根入口 `index.js`）。 */
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))

/** 激活前必须就绪的服务：系统提示词、工作区注册表、会话查询、Connection。 */
const REQUIRED_SERVICES = ['systemPrompt', 'workspaceRegistry', 'sessionQuery', 'connection']

/** 提示词上下文的名字；带命名空间，绝不会和内置上下文重名。 */
const CONTEXT_NAME = 'workspace-prompt:current'

/** 注入上下文相对「当前工作目录」上下文的偏移：紧跟其后，但排在工作目录之前。 */
const CONTEXT_ORDER_OFFSET = -5

/**
 * `getContextOrder('WORKING_DIRECTORY')` 不可用时的回退基准值。
 * 只影响这个上下文在系统提示词里的出现位置，不影响功能。
 */
const WORKING_DIRECTORY_ORDER_FALLBACK = 485

/**
 * 激活 Host 半。始终被调用；服务齐备后才真正注册。
 * @param {object} ctx - Host 上下文。
 * @param {object} [config] - 插件配置（普通对象，无需 schemastery）。
 * @param {string} [config.promptDirectory] - 覆盖默认提示词目录（`DSH_WORKSPACE_PROMPT_DIR` 仍优先）。
 */
export function apply(ctx, config = {}) {
  ctx.inject(REQUIRED_SERVICES, (readyCtx) => {
    activate(readyCtx, config)
  })
}

/**
 * 在依赖齐备的子上下文里完成全部注册。
 * @param {object} ctx - 已具备四个服务的子上下文。
 * @param {object} config - 插件配置。
 */
function activate(ctx, config) {
  const warn = createWarner(ctx)

  // 目录解析：环境变量 > config.promptDirectory > <插件包根>/prompt。
  promptStore.configurePromptStore({ directory: config?.promptDirectory, onWarn: warn })
  const promptDirectory = promptStore.promptDirectory()
  const stateDirectory = promptStore.stateDirectory()

  // 目录先建好，第一个打开窗口的人不必等目录创建竞态。
  ctx.effect(() => {
    try {
      mkdirSync(promptDirectory, { recursive: true })
      mkdirSync(stateDirectory, { recursive: true })
    } catch (error) {
      warn(`准备提示词目录失败：${describeError(error)}`)
    }
  }, 'dsh-workspace-prompt: directories')

  const enableStore = createEnableStore({
    path: join(stateDirectory, 'enabled.json'),
    onWarn: warn,
  })
  const registry = createInjectionRegistry()
  const resolver = createWorkspaceResolver({
    sessionQuery: ctx.sessionQuery,
    workspaceRegistry: ctx.workspaceRegistry,
    onWarn: warn,
  })

  // 系统提示词运行时上下文：同步求值，未命中缓存时本步不注入并异步预热。
  ctx.effect(() => ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: contextOrder(ctx.systemPrompt, warn),
    interpolate: false,
    text: (context) => injectionText(context, { resolver, enableStore, registry, warn }),
  }), 'dsh-workspace-prompt: prompt context')

  // 浏览器半的数据面。按 workspaceId 定位的新路由需要 `ctx.workspaceRegistry.list()`；
  // REQUIRED_SERVICES 已保证它存在，这里只是把它显式交给路由层。
  const routes = createRoutes({
    resolver,
    promptStore,
    enableStore,
    registry,
    workspaceRegistry: ctx.workspaceRegistry,
    onWarn: warn,
  })
  for (const route of routes) {
    ctx.effect(
      () => ctx.connection.fetch.register(route),
      `dsh-workspace-prompt: route ${route.path}`,
    )
  }

  ctx.logger?.info?.(
    `dsh-workspace-prompt: 已就绪，提示词目录 ${promptDirectory}`
    + `（工作区提示词注入 ${CONTEXT_NAME}）`,
  )
}

/**
 * 系统提示词注入回调（**同步**，不能 await）。
 *
 * 决策链：`context.agent` → `agent.session.header.cwd` → 同步缓存里的工作区
 * → 启用开关 → 正文非空 → 记录注入 → 返回待注入文本。
 * 任一步不满足都返回空串（空串上下文不会进入系统提示词）。
 *
 * @param {object} context - `AssembleContext`；`agent` 是运行时字段（类型未声明），需判空。
 * @param {object} deps - 解析器、开关、记录表与告警出口。
 * @returns {string} 注入文本；不注入时为空串。
 */
function injectionText(context, { resolver, enableStore, registry, warn }) {
  try {
    // 与 dsh 的 working-directory 包同样用法：agent 是运行时字段，类型里没有。
    const agent = context?.agent
    if (agent === undefined || agent === null) return ''
    const session = agent.session
    if (session === undefined || session === null) return ''
    const sessionId = session.id ?? session.header?.id

    // 每一步的判定结果都回报给注入记录表：既让 Toast 拿到"当时真正发生了什么"，
    // 也让 GET /injection 不必再现场解析会话（省掉 realpath 磁盘 IO）。
    const miss = (reason) => {
      if (sessionId !== undefined) registry.report({ sessionId, reason })
      return ''
    }

    const cwd = session.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return miss('no-workspace')
    // 同步缓存查询；未命中时 resolveCwdSync 内部已触发异步预热，本步不注入。
    const workspace = resolver.resolveCwdSync(cwd)
    if (workspace === undefined) return miss('no-workspace')
    if (!enableStore.get(workspace.id)) return miss('disabled')
    // readSync 在热路径上是只读的（不分配文件名、不写盘）。
    const body = promptStore.readSync(workspace)
    if (body.trim() === '') return miss('empty')
    if (sessionId !== undefined) {
      registry.report({
        sessionId,
        workspaceId: workspace.id,
        workspaceName: workspace.title,
        characters: body.length,
        reason: 'injected',
      })
    }
    return `Workspace prompt (workspace: "${workspace.title}"):\n${body}`
  } catch (error) {
    // 注入路径绝不能把异常抛回模型循环。
    warn(`注入工作区提示词失败：${describeError(error)}`)
    return ''
  }
}

/**
 * 计算注入上下文的 order：紧跟「当前工作目录」上下文（-5）。
 * `getContextOrder('WORKING_DIRECTORY')` 取不到（抛错或返回非数值）时回退固定值，绝不让插件起不来。
 * @param {object} systemPrompt - `ctx.systemPrompt`。
 * @param {(message: string) => void} warn - 告警出口。
 * @returns {number} 该上下文的排序值。
 */
function contextOrder(systemPrompt, warn) {
  const fallback = WORKING_DIRECTORY_ORDER_FALLBACK + CONTEXT_ORDER_OFFSET
  try {
    const base = systemPrompt.getContextOrder('WORKING_DIRECTORY')
    if (typeof base === 'number' && Number.isFinite(base)) return base + CONTEXT_ORDER_OFFSET
    warn(`取不到上下文顺序 WORKING_DIRECTORY（返回 ${String(base)}），已回退为 ${fallback}。`)
  } catch (error) {
    warn(`取不到上下文顺序 WORKING_DIRECTORY，已回退为 ${fallback}：${describeError(error)}`)
  }
  return fallback
}

/**
 * 告警出口：接到 ctx.logger.warn，并对重复消息去重（注入路径每个模型步骤都会跑，不能刷屏）。
 * @param {object} ctx - Host 上下文。
 * @returns {(message: string) => void} 告警函数。
 */
function createWarner(ctx) {
  const seen = new Set()
  return (message) => {
    const text = `dsh-workspace-prompt: ${message}`
    if (seen.has(text)) return
    if (seen.size >= 100) seen.clear()
    seen.add(text)
    ctx.logger?.warn?.(text)
  }
}

/** 把任意错误转成可读的一行。 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}
