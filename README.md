# 投流素材混剪工具（MVP）

## 本地启动（开发模式）
```bash
cp .env.example .env
mkdir -p data/materials data/exports
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
# 首次：迁移 + 种子数据
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web npx prisma migrate dev --schema packages/db/prisma/schema.prisma
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec worker npm run seed
```
访问 http://localhost:3000

## 测试账号
| 角色 | 账号 | 密码 |
|---|---|---|
| 运营 | operator | op123456 |
| 学员 | student | stu123456 |
| 学员密钥 | DEMO-KEY-2026 | — |

## 生产模式（服务器部署同此）
```bash
docker compose up -d --build
docker compose exec web npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
docker compose exec worker npm run seed   # 首次
```

## 单元测试
```bash
npm install && npx vitest run
```

## 运维须知
- 首次部署迁移会给 `users` 加 `email NOT NULL` 无默认列——只能对**全新/空 users 表**执行；已有真实用户的库需先加一步 backfill 迁移（先加可空列→回填→改 NOT NULL）。
- SMTP 密码用派生自 `JWT_SECRET` 的密钥加密存储——**轮换 `JWT_SECRET` 会让已存的 SMTP 密码无法解密**（需在后台重新填写），且会使所有登录 cookie 失效。
