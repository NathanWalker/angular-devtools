---
title: 'Why we built the shop on Analog'
date: '2026-09-22'
author: 'Kam'
cover: /blog/code.webp
summary: 'File-based routes, server loads next to each page, and Vite speed.'
slug: why-we-built-on-analog
---

# Why we built the shop on Analog

![](/blog/code.webp)

We wanted a stack where a new page is a new file and the data it needs sits right next to it.

## One file per page

Every page in the shop lives in `src/app/pages`. The product page is `products/[id].page.ts`, and its data comes from `products/[id].server.ts`. No routing table to keep in sync.

## Data where it is used

A `load()` function runs on the server, and the page receives the result as an input. The product list, the product page and the home page all work this way.

## Fast feedback

Vite rebuilds in milliseconds, and the Nitro server hot-reloads API routes, so changing a handler never needs a restart.
