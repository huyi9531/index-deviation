/// <reference types="vite/client" />
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '~/styles/app.css?url'

const NAV = [
  { to: '/', label: '总览' },
  { to: '/method', label: '方法与数据' },
] as const

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      {
        title: '指数偏离度监控 · Deviation Monitor',
      },
      {
        name: 'description',
        content:
          '用 60 日 / 200 日均线的对数偏离度，量化标普500、纳斯达克100与沪深300、中证A500、中证500、创业板指的超买超卖位置与历史概率。',
      },
      { name: 'color-scheme', content: 'light' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'icon',
        href:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#15171a"/><path d="M5 21l6-7 5 4 6-9" fill="none" stroke="#f5f6f4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22" cy="9" r="2.6" fill="#a85e06"/></svg>',
          ),
      },
    ],
  }),
  errorComponent: RootError,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="min-h-dvh">
          <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-4 px-4 sm:gap-8 sm:px-5">
              <Link to="/" className="flex shrink-0 items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-ink shadow-card">
                  <svg viewBox="0 0 32 32" className="h-[15px] w-[15px]">
                    <path
                      d="M5 21l6-7 5 4 6-9"
                      fill="none"
                      stroke="#f5f6f4"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="hidden flex-col leading-tight sm:flex">
                  <span className="text-[13.5px] font-semibold tracking-[-0.01em]">
                    指数偏离度监控
                  </span>
                  <span className="num text-[9.5px] font-medium uppercase tracking-[0.16em] text-faint">
                    Deviation Monitor
                  </span>
                </span>
              </Link>

              <nav className="flex min-w-0 items-center gap-1 text-[13px] sm:gap-1.5 sm:text-[13.5px]">
                {NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    activeOptions={{ exact: item.to === '/' }}
                    className="relative whitespace-nowrap px-2 py-2 text-muted transition-colors hover:text-ink sm:px-3"
                    activeProps={{
                      className:
                        'relative whitespace-nowrap px-2 py-2 sm:px-3 text-ink font-medium after:absolute after:inset-x-2.5 after:bottom-0 after:h-[1.5px] after:rounded-full after:bg-ink',
                    }}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main className="mx-auto max-w-[1180px] px-4 pb-24 pt-8 sm:px-5 sm:pt-10">
            {children}
          </main>

          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-7 text-[12px] text-faint sm:px-5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted">数据来源</span>
                <span>Yahoo Finance（美股）· 东方财富（A 股）</span>
              </div>
              <span className="hidden text-line-strong sm:inline">|</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted">偏离度</span>
                <span className="num">100 × ln(收盘 ÷ 均线)</span>
              </div>
              <span className="hidden text-line-strong sm:inline">|</span>
              <a
                href="/api/sp500"
                className="num font-medium text-muted hover:text-ink-2"
                title="JSON 接口：把 sp500 换成任意指数 id，或用 all 一次取全部"
              >
                JSON 接口 /api/&#123;indexId&#125;
              </a>
              <span className="ml-auto">仅供研究参考，不构成投资建议</span>
            </div>
          </footer>
        </div>
        <Scripts />
      </body>
    </html>
  )
}

function RootError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="mx-auto max-w-[720px] px-5 py-24">
      <p className="label-xs">出错了</p>
      <h1 className="mt-2 text-xl font-semibold">页面无法加载</h1>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface p-4 text-[12px] text-ink-2">
        {message}
      </pre>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md bg-ink px-4 py-2 text-[13px] text-white"
      >
        回到总览
      </Link>
    </div>
  )
}

function NotFound() {
  return (
    <div className="mx-auto max-w-[720px] px-5 py-24">
      <p className="label-xs">404</p>
      <h1 className="mt-2 text-xl font-semibold">这里没有页面</h1>
      <Link
        to="/"
        className="mt-6 inline-block rounded-md bg-ink px-4 py-2 text-[13px] text-white"
      >
        回到总览
      </Link>
    </div>
  )
}
