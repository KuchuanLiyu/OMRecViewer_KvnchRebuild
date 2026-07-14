import { ref, watch } from "vue";

export type Locale = "en" | "zh" | "ja";

const saved = localStorage.getItem("lang") as Locale | null;
export const locale = ref<Locale>(saved ?? "en");
watch(locale, (v) => localStorage.setItem("lang", v));

const dict: Record<Locale, Record<string, string>> = {
  en: {
    brand_title: "OPUS MAGNUM",
    brand_sub: "LEADERBOARD TERMINAL",
    section_query: "PUZZLE SEARCH",
    placeholder_search: "Type puzzle name (e.g. Mist)...",
    btn_execute: "SEARCH",
    btn_refresh: "REFRESH",
    section_diag: "DIAGNOSTICS",
    status_syncing: "SYNCING",
    status_fetching: "FETCHING",
    status_error: "ERROR",
    status_ready: "READY",
    cache_label: "CACHE:",
    breadcrumb: "Alchemical Archives / Data Flow / Record Grid",
    sys_online: "SYS: ONLINE",
    welcome_line1: "> THE ALCHEMICAL ENGINE AWAITS.",
    welcome_line2: "> SPEAK A PUZZLE NAME TO BEGIN...",
    mode_record: "RECORD",
    mode_frontier: "FRONTIER",
    mode_pareto: "PARETO",
    mode_analysis: "ANALYSIS",
    mode_improve: "IMPROVE",
    btn_download: "↓ DOWNLOAD",
    sort_label: "SORT:",
    col_category: "CATEGORY",
    col_score: "SCORE (@V / @∞)",
    col_sum: "Sum",
    col_sum4: "Sum4",
    col_derived: "Derived",
    empty_table: "NO RECORDS FOUND.",
    filter_t: "T",
    filter_o: "!O",
    view_v_inf: "@V+∞",
    view_v: "@V",
    view_inf: "@∞",
    preview_title: "RECORD PREVIEW",
    preview_no_gif: "NO PREVIEW",
    preview_loading: "LOADING...",
    preview_failed: "LOAD FAILED",
    preview_author: "AUTHOR",
    preview_updated: "UPDATED",
    preview_gif: "GIF",
    preview_solution: "SOLUTION",
    preview_copy: "COPY",
    btn_replay: "Replay",
    improve_title: "SOLUTION IMPROVEMENT ANALYZER",
    improve_sub: "Enter your metrics to find optimization targets",
    improve_legend1: "▼ = can optimize to this target",
    improve_legend2: "▲ = already good, no change needed",
    improve_legend3: "Lower # = higher priority",
    improve_legend4: "Target = nearest Pareto record that dominates yours",
    improve_analyze: "ANALYZE",
    improve_hint: "Enter your solution metrics above and click ANALYZE",
    improve_pareto_yes: "◆ YOUR SOLUTION IS PARETO-OPTIMAL",
    improve_pareto_no: "◆ NOT ON PARETO FRONTIER — compare to nearest dominator below",
    improve_target: "TARGET:",
    improve_section: "OPTIMIZATION PRIORITY",
    improve_best: "best",
    improve_can: "Can",
    pareto_title: "PARETO — Grouped by Strongest Dimensions",
    pareto_desc: "strongest dims",
    pareto_sub: "records · groups",
    pareto_compare: "COMPARE (2)",
    pareto_exit_compare: "EXIT COMPARE",
    pareto_comparing: "COMPARING",
    pareto_compare_title: "COMPARISON: Current → Potential Upgrade Paths",
    pareto_dimension: "Dimension",
    pareto_current: "Current",
    pareto_no_data: "No data — search a puzzle first",
    hull_title: "Optimization Frontier Explorer",
    hull_sub: "metrics · examining trade-off boundaries",
    hull_show_gaps: "Show opportunities",
    hull_x_axis: "X Axis",
    hull_y_axis: "Y Axis",
    hull_weakness_title: "Optimization Potential",
    hull_weakness_desc: "Records inside the frontier in multiple projections. Higher = more improvement directions.",
    hull_priority: "PRIORITY",
    hull_empty: "Every Pareto record here lies on the frontier edge — no obvious weak spots. Try a different puzzle.",
    analysis_loading: "Loading chart...",
    analysis_pareto_header: "Pareto Records",
    analysis_hover_hint: "hover → highlight",
    analysis_empty: "No Pareto records. Search a puzzle first.",
    analysis_meta: "metrics · {n} Pareto",
    level_strong: "Strong",
    level_medium: "Medium",
    level_weak: "Weak",
    hull_legend_curve: "Convex hull frontier (theoretical best trade-off)",
    hull_legend_point: "Pareto record",
    hull_legend_scale: "+50 = optimizable · −50 = stable",
    hull_legend_note: "(2D projections — checks each dimension-pair frontier)",
    ell_legend_1sigma: "Within 1σ — balanced, room to specialize",
    ell_legend_2sigma: "1σ–2σ — moderately specialized",
    ell_legend_outside: "Outside 2σ — extreme, hard to improve",
    ell_legend_centroid: "Centroid",
    ell_ranking_title: "Optimizability Ranking",
    ell_optimizable_label: "optimizable",
    ell_legend_note: "(n-D ellipsoid — Mahalanobis distance from centroid)",
    three_arrows: "Green arrows = optimization direction (toward balance)",
    pca_note: "<b>What PCA shows:</b> All {n} metrics compressed to 2 dimensions.<br/>• Close points = similar across <b>all</b> metrics.<br/>• Clusters = solution types. Gaps = unexplored types.<br/>• PC1={pc1}% of variance captured by X axis alone.<br/><b>How to use:</b> Pareto far from cluster = extreme specialist. Center = balanced.",
    ellipsoid_title: "Ellipsoid Model",
    ellipsoid_desc: "records · 1σ=67% · 2σ=95% confidence",
    analysis_help: `===== GUIDE: How to Read This Analysis =====

1. WHAT IS A PARETO RECORD?
   A record where NO other record beats it simultaneously in Cost, Cycles, AND Area.
   If another solution has lower cost AND lower cycles AND lower area, it "dominates" this one.
   Pareto records are NOT dominated — they represent the best possible trade-offs between metrics.

2. CONVEX HULL CHART (top section)
   • Red curve = the "best possible trade-off frontier" in this 2D projection.
     Points ON the curve have maxed out their 2D trade-off. Points INSIDE have room to improve.
   • Gold dots = Pareto records (non-dominated). Gray dots = all other records.
   • Green diamonds = "breakthrough gaps" — empty regions along the frontier where a new Pareto record could emerge.

3. DIMENSION SCORES [±50]
   Each dimension gets a score showing how close it is to the frontier edge:
   • [+50] = far from the edge → lots of room to optimize this metric
   • [  0] = moderate — some optimization possible
   • [−50] = right on the edge → already at the limit, hard to improve further
   • (Strong)  = ≥60% of 2D projections show this metric on the hull edge (stable)
   • (Medium)  = 30-59% on edge
   • (Weak)    = <30% on edge → this metric has clear optimization potential
   • → target  = the top-25% Pareto value in this dimension (a realistic achievable goal)

4. OVERALL OPTIMIZABILITY SCORE (right side, e.g. [+38])
   Average of all dimension [±50] scores for this record.
   High positive = balanced record, can be pushed toward any extreme (specialize).
   High negative = already at the limit in most dimensions (hard to improve further).

5. [Leader] TAG
   Appears when a record has at least one leaderboard category (CG, CI, TC, etc.).
   These are "champion" solutions that have earned specific category titles.

6. ELLIPSOID MODEL (bottom section)
   Fits an n-dimensional ellipsoid to all Pareto records using Mahalanobis distance.
   • 1σ ellipse (green solid)  = 67% of records fall inside this region.
     Inside = "balanced" solutions with room to specialize in any direction.
   • 2σ ellipse (yellow dashed) = 95% of records fall inside.
     Outside = "extreme specialists" — very hard to improve further.
   • Gold cross (+) = centroid (average Pareto solution).
     Points closer to it = more "average" = more directions to improve.
   • Ranking list: each record's distance from centroid. Higher % = closer to center = more optimizable.

7. 3D VIEW [3D]
   • Drag to rotate, scroll to zoom. Hover to see scores.
   • Red/Green/Blue axes = the 3 selected metrics (labeled below canvas).
   • Green arrows = optimization direction for each Pareto point, pointing toward the centroid.
     Longer arrow = more room to move toward balance. No arrow = already at extreme.
   • Hover a point → its score appears. Also works in reverse: hover right-side list to highlight in 3D.

8. nD-PCA VIEW
   Reduces ALL dimensions to 2 principal components (the directions of maximum variance).
   PC1% and PC2% tell you how much of the total variation each axis captures.
   Clusters and gaps in this view reveal the true structure of the solution space.

TL;DR — HOW TO USE THIS PAGE:
   → Find records with high [+XX] scores → they have clear optimization paths.
   → Look at which dimensions are (Weak) → those are your easiest wins.
   → Check the target values (→) → realistic goals based on existing Pareto solutions.
   → Use the ellipsoid ranking → higher % = more balanced = easier to surpass.
   → Search for [Leader] tags → those are the current champions to beat.

9. KNN ISOLATION DETECTION
   Measures how far each Pareto record is from its k-nearest neighbors across ALL dimensions.
   • Green clustered (≤33%) = tight group — well-explored region, easy to replicate.
   • Yellow normal (34-66%) = moderate distance — typical solution density.
   • Red isolated (67-100%) = far from neighbors — outlier! Unique approach.
     With [Leader] = tough champion. Without [Leader] = potential optimization target.
   In 3D: larger sphere = more isolated. Use this to find unusual solutions!`,
    replay_title: "LIVE REPLAY",
    replay_loading: "Loading engine…",
    replay_sending: "Sending solution…",
    replay_error: "Replay failed",
    knn_label: "KNN:",
    knn_clustered: "clustered",
    knn_normal: "normal",
    knn_isolated: "isolated",
    knn_tooltip: "KNN Isolation: How far this solution is from its nearest neighbors in n-dimensional space. Higher % = more unique/isolated = potentially easier to beat or harder to replicate.",
    knn_help: `9. KNN ISOLATION DETECTION
   Measures how far each Pareto record is from its k-nearest neighbors across ALL dimensions.
   • 🟢 clustered (≤33%) = tight group — solution is in a well-explored region.
     Many similar solutions exist. Easy to replicate, hard to beat dramatically.
   • 🟡 normal (34-66%) = moderate distance — typical solution density.
   • 🔴 isolated (67-100%) = far from neighbors — outlier solution.
     Unique approach! Either a genius breakthrough OR an unexploited vulnerability.
     Isolated records with [Leader] tags = very hard to beat champions.
     Isolated records without [Leader] = potential optimization targets.
   In 3D view: sphere size = isolation level (bigger = more isolated).`,
    lang_label: "LANG",
  },
  zh: {
    brand_title: "OPUS MAGNUM",
    brand_sub: "排行榜终端",
    section_query: "谜题搜索",
    placeholder_search: "输入谜题名称（例如 Mist）...",
    btn_execute: "搜索",
    btn_refresh: "刷新",
    section_diag: "系统诊断",
    status_syncing: "同步中",
    status_fetching: "获取中",
    status_error: "异常",
    status_ready: "就绪",
    cache_label: "缓存：",
    breadcrumb: "炼金档案 / 数据流 / 记录网格",
    sys_online: "系统：在线",
    welcome_line1: "> 炼金引擎已就绪。",
    welcome_line2: "> 输入谜题名称开始查询...",
    mode_record: "记录",
    mode_frontier: "前沿",
    mode_pareto: "帕累托",
    mode_analysis: "分析",
    mode_improve: "优化",
    btn_download: "↓ 下载",
    sort_label: "排序：",
    col_category: "分类",
    col_score: "分数 (@V / @∞)",
    col_sum: "合计",
    col_sum4: "四维和",
    col_derived: "衍生",
    empty_table: "未找到记录。",
    filter_t: "无轨",
    filter_o: "无叠",
    view_v_inf: "@V+∞",
    view_v: "@V",
    view_inf: "@∞",
    preview_title: "记录预览",
    preview_no_gif: "无预览",
    preview_loading: "加载中...",
    preview_failed: "加载失败",
    preview_author: "作者",
    preview_updated: "更新",
    preview_gif: "动图",
    preview_solution: "解法",
    preview_copy: "复制",
    btn_replay: "实时演算",
    improve_title: "解法优化分析器",
    improve_sub: "输入你的指标以寻找优化目标",
    improve_legend1: "▼ = 可优化至该目标",
    improve_legend2: "▲ = 已足够好，无需改动",
    improve_legend3: "数字越小 = 越优先优化",
    improve_legend4: "目标 = 离你最近且支配你的帕累托记录",
    improve_analyze: "分析",
    improve_hint: "在上方输入你的解法指标并点击分析",
    improve_pareto_yes: "◆ 你的解法已是帕累托最优",
    improve_pareto_no: "◆ 尚未达到帕累托前沿 — 参考下方最近支配者",
    improve_target: "对标：",
    improve_section: "优化优先级",
    improve_best: "最佳",
    improve_can: "可降",
    pareto_title: "帕累托分析 — 按最强维度分组",
    pareto_desc: "最强维度",
    pareto_sub: "条记录 · 个分组",
    pareto_compare: "对比 (2)",
    pareto_exit_compare: "退出对比",
    pareto_comparing: "对比中",
    pareto_compare_title: "对比：当前 → 潜在升级方向",
    pareto_dimension: "维度",
    pareto_current: "当前",
    pareto_no_data: "暂无数据 — 请先搜索谜题",
    hull_title: "优化前沿探索器",
    hull_sub: "个指标 · 探索权衡边界",
    hull_show_gaps: "显示突破点",
    hull_x_axis: "X 轴",
    hull_y_axis: "Y 轴",
    hull_weakness_title: "优化潜力",
    hull_weakness_desc: "在多个投影中位于前沿曲线内部的记录。数值越高 = 可优化方向越多。",
    hull_priority: "优先",
    hull_empty: "所有帕累托记录均位于前沿边缘 — 暂无明显的可突破方向。试试其他谜题。",
    analysis_loading: "图表加载中...",
    analysis_pareto_header: "帕累托记录",
    analysis_hover_hint: "悬停 → 高亮",
    analysis_empty: "暂无帕累托记录。请先搜索谜题。",
    analysis_meta: "个指标 · {n} 条帕累托",
    level_strong: "强",
    level_medium: "中",
    level_weak: "弱",
    hull_legend_curve: "凸包前沿（理论最优权衡曲线）",
    hull_legend_point: "帕累托记录",
    hull_legend_scale: "+50 = 可优化 · −50 = 已稳定",
    hull_legend_note: "（2D 投影 — 逐维度对检查前沿边缘）",
    ell_legend_1sigma: "1σ 内 — 均衡，有专精空间",
    ell_legend_2sigma: "1σ–2σ — 中等专精",
    ell_legend_outside: "2σ 外 — 极端，难以优化",
    ell_legend_centroid: "质心",
    ell_ranking_title: "可优化性排名",
    ell_optimizable_label: "可优化",
    ell_legend_note: "（n 维椭球 — 马氏距离到质心）",
    three_arrows: "绿色箭头 = 优化方向（指向更均衡的位置）",
    pca_note: "<b>PCA 显示什么：</b>全部 {n} 个指标压缩到 2 个维度。<br/>• 靠近的点 = 在<b>所有</b>指标上都相似。<br/>• 聚类 = 解法类型。聚类之间的空白 = 未探索类型。<br/>• PC1={pc1}% 的方差被 X 轴单独捕获。<br/><b>如何使用：</b>远离主聚类的帕累托点 = 极端专精。中心点 = 均衡通用。",
    ellipsoid_title: "椭球模型",
    ellipsoid_desc: "条记录 · 1σ=67% · 2σ=95% 置信区间",
    analysis_help: `===== 指南：如何阅读此分析 =====

1. 什么是帕累托记录？
   没有其他记录能在成本、周期、面积上同时击败它。
   如果有另一个解法的 cost 更低、cycles 更少、area 更小 → 它就"支配"了这条记录。
   帕累托记录不受支配 —— 代表了指标间的最佳权衡。

2. 凸包图（上方）
   • 红色曲线 = 这个 2D 投影中的"最优权衡前沿"。
     在曲线上的点已经把该二维权衡推到了极限。曲线内部的点还有优化空间。
   • 金色点 = 帕累托记录。灰色点 = 所有其他记录。
   • 绿色菱形 = "突破间隙" —— 前沿上空白的区域，可能存在新的帕累托解。

3. 维度得分 [±50]
   每个维度有一个分数，表示离前沿边缘有多近：
   • [+50] = 远离边缘 → 有很大优化空间
   • [  0] = 中等 → 有一定优化可能
   • [−50] = 紧贴边缘 → 已达极限，难以继续优化
   • (强) = ≥60% 的 2D 投影中该维度位于凸包边缘（稳定）
   • (中) = 30-59% 在边缘
   • (弱) = <30% 在边缘 → 这个维度有明显的优化潜力
   • → 目标值 = 帕累托记录中该维度的前 25% 值（现实可达的目标）

4. 总体可优化性得分（右侧，如 [+38]）
   该记录所有维度 [±50] 分数的平均值。
   正数大 = 均衡型，可向任意极端方向专精。
   负数大 = 已在大多数维度达到极限，难以继续优化。

5. [Leader] 标签
   出现在至少拥有一个分类榜头衔（CG、CI、TC 等）的记录上。
   这些是获得特定分类冠军称号的解法。

6. 椭球模型（下方）
   用马氏距离对所有帕累托记录拟合 n 维椭球。
   • 1σ 椭圆（绿色实线）= 67% 的记录落在内部。
     内部 = "均衡型"解法，有向各方向专精的空间。
   • 2σ 椭圆（黄色虚线）= 95% 的记录落在内部。
     外部 = "极端专精型" —— 非常难以继续优化。
   • 金色十字 (+) = 质心（平均帕累托解）。离它越近 = 越"平均" = 可优化方向越多。
   • 排名表：每条记录到质心的距离。百分比越高 = 离中心越近 = 越可优化。

7. 3D 视图 [3D]
   • 拖拽旋转，滚轮缩放。悬停看分数。
   • 红/绿/蓝坐标轴 = 选择的 3 个指标（图例在画布下方）。
   • 绿色箭头 = 每个帕累托点的优化方向，指向质心（更均衡的位置）。
     箭头越长 = 向均衡移动的空间越大。无箭头 = 已处于极端。
   • 悬停球体 → 显示分数。反向也有效：悬停右侧列表 → 3D 图中高亮。

8. nD-PCA 视图
   用主成分分析将所有维度压缩到 2 个主成分（方差最大的方向）。
   PC1% 和 PC2% 表示每个轴捕获了多少总方差。
   该视图中的聚类和空白揭示了解决空间的真实结构。

简明用法：
   → 找 [+XX] 高的记录 → 有明确的优化路径。
   → 看哪些维度是 (弱) → 最容易突破的方向。
   → 查看 → 目标值 → 基于现有帕累托解的现实目标。
   → 用椭球排名 → 百分比越高 = 越均衡 = 越容易被超越。
   → 搜索 [Leader] 标签 → 当前需要击败的冠军。

9. KNN 隔离检测
   衡量每条帕累托记录在所有维度中离 k-近邻的平均距离。
   • 🟢 聚集 (≤33%) = 紧密聚类 — 已被充分探索的区域，容易复现。
   • 🟡 常态 (34-66%) = 中等距离 — 典型解法密度。
   • 🔴 孤立 (67-100%) = 远离邻居 — 离群值！独特思路。
     带 [Leader] = 极难被击败的冠军。无 [Leader] = 潜在优化突破口。
   3D 视图中：球体越大 = 越孤立。用这个功能发现独特解法！`,
    replay_title: "实时演算",
    replay_loading: "加载演算引擎…",
    replay_sending: "发送解法数据…",
    replay_error: "演算失败",
    knn_label: "KNN:",
    knn_clustered: "聚集",
    knn_normal: "常态",
    knn_isolated: "孤立",
    knn_tooltip: "KNN 隔离度：该解法在 n 维空间中离最近邻居的距离。百分比越高 = 越独特/孤立 = 可能是天才解法，也可能是容易超越的异常点。",
    knn_help: `9. KNN 隔离检测
   衡量每条帕累托记录在所有维度中离 k-近邻的平均距离。
   • 🟢 聚集 (≤33%) = 紧密聚类 — 解法处于已被充分探索的区域。
     附近有许多相似解法。容易复现，但难以大幅超越。
   • 🟡 常态 (34-66%) = 中等距离 — 典型解法密度。
   • 🔴 孤立 (67-100%) = 远离邻居 — 离群解法。
     独特思路！可能是天才突破，也可能是未被利用的软肋。
     带 [Leader] 标签的孤立记录 = 极难被击败的冠军。
     无 [Leader] 标签的孤立记录 = 潜在的优化突破口。
   3D 视图中：球体越大 = 越孤立。`,
    lang_label: "语言",
  },
  ja: {
    brand_title: "OPUS MAGNUM",
    brand_sub: "リーダーボード端末",
    section_query: "パズル検索",
    placeholder_search: "パズル名を入力（例: Mist）...",
    btn_execute: "検索",
    btn_refresh: "更新",
    section_diag: "診断",
    status_syncing: "同期中",
    status_fetching: "取得中",
    status_error: "エラー",
    status_ready: "準備完了",
    cache_label: "キャッシュ：",
    breadcrumb: "錬金文書 / データフロー / 記録グリッド",
    sys_online: "システム：オンライン",
    welcome_line1: "> 錬金エンジンが待機しています。",
    welcome_line2: "> パズル名を入力してください...",
    mode_record: "記録",
    mode_frontier: "フロンティア",
    mode_pareto: "パレート",
    mode_analysis: "分析",
    mode_improve: "改善",
    btn_download: "↓ ダウンロード",
    sort_label: "並替：",
    col_category: "カテゴリ",
    col_score: "スコア (@V / @∞)",
    col_sum: "合計",
    col_sum4: "四元和",
    col_derived: "派生",
    empty_table: "記録が見つかりません。",
    filter_t: "無軌",
    filter_o: "無重",
    view_v_inf: "@V+∞",
    view_v: "@V",
    view_inf: "@∞",
    preview_title: "記録プレビュー",
    preview_no_gif: "プレビューなし",
    preview_loading: "読込中...",
    preview_failed: "読込失敗",
    preview_author: "作者",
    preview_updated: "更新",
    preview_gif: "GIF",
    preview_solution: "解法",
    preview_copy: "コピー",
    btn_replay: "再生",
    improve_title: "解法改善アナライザー",
    improve_sub: "指標を入力して最適化目標を見つける",
    improve_legend1: "▼ = この目標まで改善可能",
    improve_legend2: "▲ = すでに良好、変更不要",
    improve_legend3: "数字が小さいほど優先度が高い",
    improve_legend4: "目標 = あなたを支配する最も近いパレート記録",
    improve_analyze: "分析",
    improve_hint: "上に解法の指標を入力して分析をクリック",
    improve_pareto_yes: "◆ あなたの解法はパレート最適です",
    improve_pareto_no: "◆ パレートフロンティア未達 — 下の最近支配者を参照",
    improve_target: "目標：",
    improve_section: "最適化優先順位",
    improve_best: "最適",
    improve_can: "改善幅",
    pareto_title: "パレート分析 — 最強次元でグループ化",
    pareto_desc: "最強次元",
    pareto_sub: "件 · グループ",
    pareto_compare: "比較 (2)",
    pareto_exit_compare: "比較終了",
    pareto_comparing: "比較中",
    pareto_compare_title: "比較：現在 → 改善方向",
    pareto_dimension: "次元",
    pareto_current: "現在",
    pareto_no_data: "データなし — 先にパズルを検索してください",
    hull_title: "最適化フロンティア探索",
    hull_sub: "指標 · トレードオフ境界を探索中",
    hull_show_gaps: "突破点を表示",
    hull_x_axis: "X 軸",
    hull_y_axis: "Y 軸",
    hull_weakness_title: "最適化ポテンシャル",
    hull_weakness_desc: "複数の投影でフロンティア曲線の内側にある記録。高いほど改善方向が多い。",
    hull_priority: "優先",
    hull_empty: "すべてのパレート記録がフロンティア端にあります — 明らかな弱点は見つかりません。別のパズルを試してください。",
    analysis_loading: "チャート読込中...",
    analysis_pareto_header: "パレート記録",
    analysis_hover_hint: "ホバー → ハイライト",
    analysis_empty: "パレート記録がありません。先にパズルを検索してください。",
    analysis_meta: "指標 · {n} 件パレート",
    level_strong: "強",
    level_medium: "中",
    level_weak: "弱",
    hull_legend_curve: "凸包フロンティア（理論最適トレードオフ）",
    hull_legend_point: "パレート記録",
    hull_legend_scale: "+50 = 最適化可能 · −50 = 安定",
    hull_legend_note: "（2D投影 — 各次元ペアのフロンティアを検査）",
    ell_legend_1sigma: "1σ内 — バランス型、特化の余地あり",
    ell_legend_2sigma: "1σ–2σ — 中程度の特化",
    ell_legend_outside: "2σ外 — 極端、改善困難",
    ell_legend_centroid: "重心",
    ell_ranking_title: "最適化可能性ランキング",
    ell_optimizable_label: "最適化可能",
    ell_legend_note: "（n次元楕円体 — 重心からのマハラノビス距離）",
    three_arrows: "緑矢印 = 最適化方向（バランスの取れた位置へ）",
    pca_note: "<b>PCAが見せるもの：</b>全{n}指標を2次元に圧縮。<br/>• 近い点 = <b>全</b>指標で類似。<br/>• クラスタ = 解法タイプ。間隙 = 未探索タイプ。<br/>• PC1={pc1}%の分散をX軸が捕捉。<br/><b>使い方：</b>クラスタから遠いパレート = 極端特化型。中心 = バランス型。",
    ellipsoid_title: "楕円体モデル",
    ellipsoid_desc: "件 · 1σ=67% · 2σ=95% 信頼区間",
    analysis_help: `===== ガイド：この分析の読み方 =====

1. パレート記録とは？
   コスト、サイクル、面積の3つ全てで同時に負けない記録。
   他の解法がより低コスト、より少サイクル、より小面積なら「支配」される。
   パレート記録は非支配 ― 指標間の最良トレードオフを表す。

2. 凸包図（上部）
   • 赤曲線 = この2D投影における「最適トレードオフ境界」。
     曲線上の点は2Dトレードオフを限界まで押し上げている。内部の点には改善の余地あり。
   • 金色点 = パレート記録。灰色点 = その他全記録。
   • 緑菱形 = 「突破間隙」 ― 新しいパレート解が出現しうる空白領域。

3. 次元スコア [±50]
   各次元のスコアは境界エッジへの近さを示す：
   • [+50] = エッジから遠い → 改善の余地大
   • [  0] = 中程度 → ある程度改善可能
   • [−50] = エッジ上 → 限界到達、改善困難
   • (強) = 60%以上の投影で凸包エッジ上（安定）
   • (中) = 30-59%がエッジ上
   • (弱) = 30%未満がエッジ上 → 明確な改善可能性あり
   • → 目標値 = パレート記録中の上位25%値（現実的な到達目標）

4. 総合最適化スコア（右側、例：[+38]）
   全次元の[±50]スコアの平均値。
   高正数 = バランス型、任意の方向に特化可能。
   高負数 = ほとんどの次元で限界、改善困難。

5. [Leader] タグ
   少なくとも1つのカテゴリ（CG, CI, TC等）の首位を獲得した記録に表示。
   特定カテゴリのチャンピオンタイトルを持つ解法。

6. 楕円体モデル（下部）
   マハラノビス距離を用いて全パレート記録にn次元楕円体を適合。
   • 1σ楕円（緑実線）= 記録の67%がこの領域内。
     内部 = 「バランス型」解法、各方向への特化余地あり。
   • 2σ楕円（黄破線）= 記録の95%が内部。
     外部 = 「極端特化型」 ― 改善が非常に困難。
   • 金色十字 (+) = 重心（平均的パレート解）。近いほど「平均的」= 改善方向が多い。
   • ランキング：各記録の重心からの距離。%が高いほど中心に近く最適化可能。

7. 3Dビュー [3D]
   • ドラッグ回転、スクロールズーム。ホバーでスコア表示。
   • 赤/緑/青軸 = 選択した3指標（キャンバス下部に凡例）。
   • 緑矢印 = 各パレート点の最適化方向、重心（よりバランスの取れた位置）を指す。
     矢印が長いほどバランスへの移動余地大。矢印なし = すでに極限。
   • 球体にホバー → スコア表示。逆向きも可能：右側リストにホバー → 3Dでハイライト。

8. nD-PCAビュー
   主成分分析で全次元を2主成分（最大分散方向）に圧縮。
   PC1%とPC2%は各軸が捉える総分散の割合。
   このビューのクラスタと間隙が解空間の真の構造を明らかにする。

簡易使い方：
   → [+XX]が高い記録を探す → 明確な最適化経路あり。
   → (弱)の次元を確認 → 最も突破しやすい方向。
   → →目標値を確認 → 既存パレート解に基づく現実的目標。
   → 楕円体ランキングを活用 → %が高いほどバランス型で超えやすい。
   → [Leader]タグを探す → 打倒すべき現チャンピオン。

9. KNN 孤立検出
   各パレート記録の全次元における k-近傍との平均距離を測定。
   • 🟢 密集 (≤33%) = 密なクラスタ — 十分に探索済み、再現容易。
   • 🟡 通常 (34-66%) = 中程度の距離 — 典型的な解法密度。
   • 🔴 孤立 (67-100%) = 近傍から遠い — 外れ値！独自の発想。
     [Leader]付き = 打倒困難なチャンピオン。[Leader]なし = 最適化の突破口。
   3Dビュー：球が大きいほど孤立度が高い。この機能でユニークな解法を見つけよう！`,
    replay_title: "ライブ再生",
    replay_loading: "エンジン読込中…",
    replay_sending: "解法データ送信中…",
    replay_error: "再生失敗",
    knn_label: "KNN:",
    knn_clustered: "密集",
    knn_normal: "通常",
    knn_isolated: "孤立",
    knn_tooltip: "KNN 孤立度：n次元空間での最近傍点との距離。%が高いほどユニーク/孤立 = 天才的な解法か、突破されやすい異常値。",
    knn_help: `9. KNN 孤立検出
   各パレート記録の全次元における k-近傍との平均距離を測定。
   • 🟢 密集 (≤33%) = 密なクラスタ — 十分に探索された領域の解法。
     類似解法が多数あり。再現容易だが大幅な超越は困難。
   • 🟡 通常 (34-66%) = 中程度の距離 — 典型的な解法密度。
   • 🔴 孤立 (67-100%) = 近傍から遠い — 外れ値解法。
     独自の発想！天才的ブレイクスルーか、未知の弱点か。
     [Leader]タグ付き孤立記録 = 打倒困難なチャンピオン。
     [Leader]タグなし孤立記録 = 最適化の突破口となる可能性。
   3Dビュー：球が大きいほど孤立度が高い。`,
    lang_label: "言語",
  },
};

export function t(key: string): string {
  return dict[locale.value]?.[key] ?? dict.en[key] ?? key;
}
