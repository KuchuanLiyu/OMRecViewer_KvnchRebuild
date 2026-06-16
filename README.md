# OMRecViewer_KvnchRebuild

Forked from [Galandustry/Opus_Magnum_Record_Viewer](https://github.com/Galandustry/Opus_Magnum_Record_Viewer). 原项目是 Tauri (Rust + Vue) 桌面应用。用 Spring Boot 3 + Vue 3 重写了后端，加了一些分析工具。

## 运行

需要 JDK 17+, Maven, Node.js。

```bash
cd frontend && npm install && npm run build
cd .. && mvn spring-boot:run
# http://localhost:8080
```

## 数据来源

[ZLBB Leaderboard API](https://zlbb.faendir.com) — Opus Magnum / EXAPUNKS 排行榜。

## License

MIT
