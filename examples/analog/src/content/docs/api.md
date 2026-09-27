---
title: 'Developer API'
order: 5
slug: api
---

# Developer API

The shop exposes a small JSON API under `/api/v1`.

## Products

- `GET /api/v1/products` lists products. Add `?category=audio` to filter.
- `GET /api/v1/products/:id` returns one product, or 404.

## Orders

- `GET /api/v1/orders` lists orders with id, name, total and date. Emails and items are not returned.
- `POST /api/v1/orders` creates an order. It answers 422 with field errors when the name, email or stock check fails.
