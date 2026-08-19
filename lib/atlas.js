// dsh-dcs-cloud — DCS 云平台「数据库全图谱」（静态参考数据，供 dcs_atlas 工具与 agent 查询）。
// 内容基于 2026-08-19 对 dcs CLI v1.1.0 的实测梳理。公共库数量会随平台更新而变动，
// 这里记录的是当时快照与稳定的分类结构，用于「找数据更容易」而非替代实时查询。

// 片区图：BGI 中心节点（公共库更全，官方 DCS 流程多）与 DCS 公共云节点。
export const REGIONS = [
  { id: 'st', name: 'BGI-时空', type: 'bgi-center', publicWorkflows: 740, officialDcs: 103, note: 'BGI 中心核心节点，官方 DCS 流程最全（SAW/SC_Miner/Stereo_Miner 全系）' },
  { id: 'bgid_center', name: '医学-时空', type: 'bgi-center', publicWorkflows: 79, officialDcs: 39, note: '医学方向时空组学' },
  { id: 'bgid', name: '医学-华南1', type: 'bgi-center', publicWorkflows: 39, officialDcs: 39, note: '医学方向，官方流程齐全' },
  { id: 'cq', name: 'BGI-重庆1', type: 'bgi-center', publicWorkflows: null, officialDcs: null, note: '需先在片区内建项目才能查公共库' },
  { id: 'sugon', name: 'BGI-杭州1', type: 'bgi-center', publicWorkflows: null, officialDcs: null, note: '需先在片区内建项目' },
  { id: 'bgit', name: '科服-西南1', type: 'bgi-center', publicWorkflows: null, officialDcs: null, note: '科技服务方向，需建项目' },
  { id: 'wh', name: 'BGI-武汉1', type: 'bgi-center', publicWorkflows: null, officialDcs: null, note: '需建项目' },
  { id: 'iimr', name: 'BGI-武汉2', type: 'bgi-center', publicWorkflows: null, officialDcs: null, note: '需建项目' },
  { id: 'ali', name: 'DCS-华南1', type: 'dcs-public', publicWorkflows: 924, officialDcs: 85, note: '公共云主片区，公共流程总数最多（Genos 模型所在片区）' },
  { id: 've', name: 'DCS-华北2', type: 'dcs-public', publicWorkflows: 596, officialDcs: 38, note: '公共云，公共流程多' },
  { id: 'east2', name: 'DCS-华东2', type: 'dcs-public', publicWorkflows: null, officialDcs: null, note: '需建项目' },
];

// 官方组学工具库（dcs project omics_tools）：8 大类 → 官方 DCS 流程。
export const OMICS_TOOLS = [
  { code: 'Genomics', label: '基因组学', tools: ['DCS_Build_Index_FASTA', 'DCS_WGS_Germline_FASTQ_HumanOnly', 'DCS_WGS_Germline_FASTQ', 'DCS_WES_Germline_FASTQ', 'WGS-zbolt-fpga2', 'Lowpass_v5-NHS', 'ExpansionHunter_WGS_STR', 'seqarc_decompress', 'seqarc_index', 'seqarc_compress', 'PanGenie_WGS_SV', 'Lowpass_v5-Human', 'zbolt-build-index', 'Bcftools_Index_VCF', 'CNVpytor_WGS_CNV', 'LowpassSummary_v5'] },
  { code: 'Epigenomics', label: '表观基因组学', tools: [] },
  { code: 'Microbiomics', label: '微生物组学', tools: ['MSAP', 'minimap2-build-host-reference'] },
  { code: 'Transcriptomics', label: '转录组学', tools: ['BulkRNA-seq', 'BulkRNA-seq-build-index'] },
  { code: 'Proteomics', label: '蛋白质组学', tools: ['ESMFold'] },
  { code: 'Metabonomics', label: '代谢组学', tools: [] },
  { code: 'Single-cell Omics', label: '单细胞组学', tools: ['scVDJ-seq', 'SAW_spatial_scRNA_V2', 'scATAC-seq', 'scRNA-seq_v3', 'Copy-scRNA-seq_v3', 'Chips_scRNA_singlespecies_unlimited_S1', 'SAW_spatial_scRNA_V1', 'SC_Miner_Annotation', 'SC_Miner_Interaction', 'SC_Miner_Pseudotime', 'SC_Miner_Clustering', 'SC_Miner_Preprocessing', 'SC_Miner_data_qc', 'SC_Miner_Enrichment', 'SC_Miner_Autoannotation', 'SC_Miner_Clustering_dev', 'scRNA-seq_v3.1.5', 'Single-cell-multi-sample-anlysis', 'scVDJ-build-IMGT-ref', 'Chips_scRNA_singlespecies'] },
  { code: 'Spatial Omics', label: '空间组学（Stereo-seq）', tools: ['SAW-ST-V8', 'Stereo_Miner_Autoannotation', 'SAW-ST-V8-realign', 'SAW-ST-V6', 'Stereo_Miner_data_qc', 'Stereo_Miner_Enrichment', 'Stereo_Miner_Clustering', 'Stereo_Miner_Preprocessing', 'SAW-ST-V7', 'SAW-ST-V8-makeRef', 'SAW-ST-V8-clustering', 'SAW-ST-V8-Visualization', 'SAW-ST-V8-MIDFilter', 'SAW-ST-V8-img2rpi', 'SAW-ST-V8-gef2gem', 'SAW-ST-V8-diffexp', 'SAW-ST-V8-gem2gef', 'SAW-ST-V8-reanalyze-lasso', 'SAW-ST-V8-merge', 'SAW-ST-V8-checkGTF'] },
];

// 关键词 → 组学类别（帮助 agent 把研究问题映射到正确的工具类别）。
export const KEYWORD_TO_CATEGORY = [
  { keywords: ['wgs', 'wes', 'germline', '变异', 'snp', 'indel', 'cnv', 'sv', 'str', 'lowpass', '低深度', '全基因组', '外显子', '建索引', 'fasta'], category: 'Genomics' },
  { keywords: ['scrna', '单细胞', 'single cell', 'scatac', 'scvdj', 'vdj', '免疫组', 'cell line', '细胞系', 'multi-sample'], category: 'Single-cell Omics' },
  { keywords: ['stereo-seq', 'saw', '空间转录组', 'spatial', 'stereominer', 'stereo', 'gef', 'gem', 'bin', 'lasso', '时空组'], category: 'Spatial Omics' },
  { keywords: ['bulk rna', 'bulk-rna', '转录组', 'rna-seq', 'rnaseq', '差异表达'], category: 'Transcriptomics' },
  { keywords: ['宏基因组', 'metagenomic', '微生物', 'microbiome', '16s', 'msap', '宿主', 'rmhost'], category: 'Microbiomics' },
  { keywords: ['蛋白', 'proteom', 'esmfold', '结构', 'fold'], category: 'Proteomics' },
  { keywords: ['甲基化', 'wgbs', 'chip', 'atac', '表观', 'epigen'], category: 'Epigenomics' },
  { keywords: ['代谢', 'metabol'], category: 'Metabonomics' },
];

export function searchHints() {
  return `找数据/找流程的优先级：
1. 先定组学类别：按研究问题关键词 → 类别（Genomics/Single-cell/Spatial/Transcriptomics/Microbiomics/Proteomics/Epigenomics/Metabonomics）。
2. 官方流程优先：用 dcs_workflow_search（public=true）查公共库，命中 official_tag=DCS 的流程最稳（有官方维护与参数说明）。
3. 公共库最全的片区：BGI-时空（官方 DCS 流程 103 个最全）、DCS-华南1（公共流程总数 924 最多）、DCS-华北2（596）。查某片区公共库先 dcs region switch <region> 且需在该片区有项目。
4. 数据文件：dcs_data_find 在 /Files 全库按名称/类型/样本/SN/流程过滤；参考基因组在 /Files/ReferenceData。
5. 流程参数：dcs_workflow_info 看 check_parameter（必填项）与 plan（多步规划），再 dcs_workflow_run 投递。`;
}

// Genpilot 智能分析的实际使用范式（实测自 PGP 项目的真实任务）。
export const GENPILOT_PATTERN = {
  standardImage: 'ubuntu:24.04-python3.12',
  standardResource: '4c 16g',
  workDir: '/work/{username}/{project}_{date}/',
  dirLayout: [
    'plan.md              — 执行计划与过程文档（步骤进度表 + 产物路径 + 方法学 + 总结）',
    'scripts/stepN_*.py   — 编号步骤脚本，配套 *_run.log 与 *_exit_code.log',
    '.env                 — 系统自动生成的配置（LLM_MODEL / LLM_API_BASE 等，密钥由系统注入，无需手动填写）',
    'start.sh             — Streamlit 应用启动器（经 notebook 网关）',
    'output/              — 结果产物',
  ],
  llmApiBase: 'https://dcsapi.dcs.cloud/api/aigress/unified/v1/chat/completions',
  llmModel: 'deepseek-v4-pro',
  note: 'Genpilot LLM 与 Genos 模型均为 DCS 系统自带，自动鉴权、模型自动选择，无需额外填写 API key。',
};

export function genpilotHints() {
  return `Genpilot 智能分析典型用法（实测 PGP）：
1. 在在线容器 /work/{user}/{project}_{date}/ 建项目目录，写 plan.md（步骤进度表）。
2. 写 scripts/stepN_*.py 分步脚本；密钥由 DCS 系统自动注入，无需手动填写 API key。
3. 长任务/并行：把脚本按 --shard N --total M 分片，每片用 dcs_offline_run 投递一条离线任务（标准镜像 ubuntu:24.04-python3.12、资源 4c 16g）。
4. 简单/交互：dcs_terminal_exec 在线运行。
5. 解读与写作：dcs_llm 调 DCS 系统自带 Genpilot LLM（自动选模型），用于文献综合/变异解读/论文写作。
6. 产物：dcs_generate_report 出 HTML 网页；dcs_plan 出 Plan.md。`;
}
