# KvnchRebuild — Opus Magnum Leaderboard Viewer

基于 [Galandustry/Opus_Magnum_Record_Viewer](https://github.com/Galandustry/Opus_Magnum_Record_Viewer) 的完全重构版本。原项目是 Tauri (Rust + Vue 2) 桌面应用，本作改用 **Spring Boot 3 + Vue 3** 全栈重写，并扩展了大量分析与可视化功能。

## 功能

| 模块 | 说明 |
| --- | --- |
| **记录浏览** | ZLBB 排行榜数据查询，多维度排序，Pareto 前沿高亮 |
| **帕累托分析** | 按最强维度分组，两两对比，升级路径推导 |
| **优化前沿探索** | 2D/3D/nD-PCA 凸包图，样条拟合，突破间隙检测 |
| **解法优化器** | 输入自定义指标，查找最近的 Pareto 支配记录 |
| **椭球模型** | n 维马氏距离椭球，可优化性排名 |
| **KNN 隔离检测** | k-近邻距离，识别离群解法和独特策略 |
| **实时演算** | 内嵌 omclone WASM 引擎，弹窗回放任意解法 |
| **三语界面** | EN / 中文 / 日本語 |

## 技术栈

- **后端**: Java 17, Spring Boot 3.3, Maven
- **前端**: Vue 3, TypeScript, Vite 6, ECharts, Three.js
- **数据**: ZLBB Leaderboard API → 本地缓存
- **回放引擎**: omclone WASM (Rust → WebAssembly)
- **算法**: Graham Scan 凸包, Cholesky 分解, PCA 幂迭代, 单调三次 Hermite 样条

## 运行

```bash
# 前端
cd frontend && npm install && npm run dev    # 开发模式 http://localhost:5173

# 后端
mvn spring-boot:run                            # http://localhost:8080
```

生产部署：`cd frontend && npm run build && cd .. && mvn spring-boot:run` → 访问 `http://localhost:8080`

## Puzzle 文件

实时演算需要 `.puzzle` 文件。默认从 `omsim-puzzles/test/puzzle/` 读取（已包含 174 个官方 + 社区关卡）。`application.yml` 中配置 `app.puzzle-dir` 指向自定义路径。

基于 [ianh/omsim](https://github.com/ianh/omsim) 提供的录写 puzzle 文件。

## License

MIT
