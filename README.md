# 我们的时光 · 恋爱时间线

一个私密的恋爱时间线网站。可以上传照片、视频、音频和任意文档，按日期串成故事线。普通用户登录后只能新增记录，管理员可以编辑和删除。

## 功能

- 时间线展示：按事件日期倒序排列，每天一个节点
- 多媒体上传：图片、视频自动内嵌预览，其他文件以附件卡片展示
- 权限区分：普通用户只能上传，管理员可以编辑与删除
- 密码登录：密码使用 scrypt 加盐哈希，会话保存在 HttpOnly Cookie
- 图片灯箱：支持左右切换与键盘操作
- 登录保护：同一 IP + 账号 10 分钟内失败 10 次会被暂时锁定
- 移动端适配：手机与桌面均可正常使用

## 快速开始

```bash
npm install
npm start
```

打开 http://localhost:3000 ，会自动跳转到登录页。

首次启动会自动创建两个账号：

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 管理员 | admin | admin123 |
| 普通用户 | couple | couple123 |

登录后点击右上角「设置」可以修改密码。生产环境请立刻修改这两个默认密码。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据根目录 |
| `UPLOAD_DIR` | `./data/uploads` | 上传文件目录 |
| `DB_FILE` | `./data/timeline.db` | SQLite 数据库文件 |
| `SESSION_DAYS` | `30` | 登录保持天数 |
| `MAX_FILE_MB` | `200` | 单个文件大小上限（MB） |
| `MAX_FILES_PER_POST` | `10` | 每条记录最多文件数 |
| `ADMIN_USERNAME` | `admin` | 首次启动创建的管理员账号 |
| `ADMIN_PASSWORD` | `admin123` | 首次启动创建的管理员密码 |
| `USER_USERNAME` | `couple` | 首次启动创建的普通账号 |
| `USER_PASSWORD` | `couple123` | 首次启动创建的普通账号密码 |
| `COOKIE_SECURE` | 未设置 | 设为 `1` 时 Cookie 带上 Secure，HTTPS 部署时开启 |

首次启动的账号只在数据库为空时创建，之后通过界面修改密码即可。

## 权限说明

| 操作 | 普通用户 | 管理员 |
| --- | --- | --- |
| 浏览时间线 | 可以 | 可以 |
| 新增记录并上传文件 | 可以 | 可以 |
| 编辑记录 | 不可以 | 可以 |
| 删除整条记录 | 不可以 | 可以 |
| 删除单个文件 | 不可以 | 可以 |
| 修改自己的密码 | 可以 | 可以 |

## 数据存储

- SQLite 数据库：`data/timeline.db`
- 上传文件：`data/uploads/`
- 备份时把整个 `data/` 目录复制走即可

删除记录时数据库行与磁盘文件会一并清理。

## 目录结构

```
server.js          Express 入口、鉴权中间件与所有 API
lib/config.js      配置与环境变量
lib/db.js          SQLite 初始化、建表与数据访问
lib/security.js    密码哈希、校验与会话令牌
public/index.html  时间线主页面
public/login.html  登录页
public/404.html    错误页
public/css/style.css
public/js/app.js   前端交互逻辑
data/              数据库与上传文件
```

## 安全提醒

- 上线前修改默认密码，并把 `ADMIN_PASSWORD`、`USER_PASSWORD` 设为强密码
- 建议在 HTTPS 反向代理后运行，并设置 `COOKIE_SECURE=1`
- 上传文件名使用随机串重命名，原始文件名仅用于展示与下载
- 上传内容按用户提供的内容类型渲染，访问 `/uploads/` 时带有 `nosniff` 响应头
