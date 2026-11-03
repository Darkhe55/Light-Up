import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

/** 题库与进度存放在项目内，与浏览器配置目录无关 */
const DATA_DIR = path.resolve(__dirname, 'data')
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json')
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json')

function readJson(file: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function readStoreFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  return {
    version: 1,
    library: readJson(LIBRARY_FILE, []),
    progress: readJson(PROGRESS_FILE, {}),
    lastPuzzle: (readJson(path.join(DATA_DIR, 'last-puzzle.json'), null) as string | null) ?? null,
  }
}

function writeStoreFiles(data: {
  library?: unknown
  progress?: unknown
  lastPuzzle?: string | null
}) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const write = (file: string, value: unknown) => {
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
  }
  if (data.library !== undefined) write(LIBRARY_FILE, data.library)
  if (data.progress !== undefined) write(PROGRESS_FILE, data.progress)
  write(path.join(DATA_DIR, 'last-puzzle.json'), data.lastPuzzle ?? null)
}

/**
 * 为什么必须自己占一个端口：
 * 浏览器 HTTP 缓存按 origin(host:port)+path 存储。5173 是 Vite 的默认端口，
 * 机器上任何其它 Vite 工具都会往这个 origin 里写 /src/main.ts 之类的缓存条目；
 * 普通刷新会直接复用这些条目 → 模块图是旧的 → 页面卡在加载。
 * 兄弟项目各占一个端口（划斜线 5174 / 帐篷 5175 / 黑白 5176 / 数回 5177），点灯用 5178。
 */
const PORT = 5178

/** 开发/预览都不允许浏览器缓存任何响应，避免产生新的陈旧条目 */
const noCacheHeaders = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

/**
 * 开发期守卫
 */
function devGuards(): Plugin {
  return {
    name: 'diandeng-dev-guards',
    configureServer(server) {
      // ① 文档导航时清掉该 origin 的 HTTP 缓存
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path === '/' || path === '/index.html') {
          res.setHeader('Clear-Site-Data', '"cache"')
        }
        next()
      })

      // ② index.html 的兜底脚本把"页面为什么没起来"post 到这里，直接出现在终端
      server.middlewares.use('/__boot-failure', (req, res) => {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          server.config.logger.error(`[boot] 页面启动失败：${body || '(无详情)'}`)
          res.statusCode = 204
          res.end()
        })
      })

      // ③ 题板存储：题库/进度/上次题目读写到项目内 data/ 目录
      //    GET  → 返回 data/library.json + data/progress.json + data/last-puzzle.json
      //    POST → 原子写回这三个文件（先写 .tmp 再 rename）
      server.middlewares.use('/__store', (req, res, next) => {
        const p = (req.url || '').split('?')[0]
        if (p !== '/' && p !== '') return next()
        if (req.method === 'GET') {
          try {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(readStoreFiles()))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(e) }))
          }
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const data = JSON.parse(body || '{}')
              writeStoreFiles({
                library: Array.isArray(data.library) ? data.library : [],
                progress: data.progress && typeof data.progress === 'object' ? data.progress : {},
                lastPuzzle: typeof data.lastPuzzle === 'string' ? data.lastPuzzle : null,
              })
              res.statusCode = 204
            } catch (e) {
              res.statusCode = 400
              res.end(String(e))
              return
            }
            res.end()
          })
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [devGuards()],
  server: {
    host: '127.0.0.1',
    port: PORT,
    // 端口被占用时直接失败，而不是悄悄换端口：否则浏览器里已打开的标签页会连到旧服务
    strictPort: true,
    headers: noCacheHeaders,
    watch: {
      // 输出目录里常有被其它程序锁定的文件（截图、日志、浏览器 profile），
      // chokidar 监视到锁定文件会抛 EBUSY 并直接搞崩 dev server
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/output/**'],
    },
  },
  preview: {
    headers: noCacheHeaders,
    strictPort: true,
  },
})
