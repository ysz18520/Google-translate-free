# AutoTranslate Pro - 开发助手配置

## 项目
- 项目名称：AutoTranslate Pro（Shopify 多语言翻译插件）
- 技术栈：Node.js + Express + Prisma + MySQL + 纯 JS 前端
- 版本：v1.2.0

## Skill 系统规则

项目目录 `.claude/skills/` 下存放 227 个 AI 专家角色定义文件。

### 模糊匹配规则
- 你可以用自然语言模糊激活 skill，例如：
  - "以前端视角..." → 匹配「前端开发者」
  - "从安全角度看看..." → 匹配「安全工程师」
  - "帮我 review 代码" → 匹配「代码审查员」
  - "这个 UI 怎么改" → 匹配「UI 设计师」
  - "数据库慢查询" → 匹配「数据库优化师」
  - "部署流程有问题" → 匹配「DevOps 自动化师」
  - "帮我写文档" → 匹配「技术文档工程师」
  - "测试覆盖不够" → 匹配「API 测试员」或「测试结果分析师」
- 一个对话中声明一次即可，我会记住当前角色直到对话结束
- 需要切换角色时直接说，例如："换个角度，从产品经理视角看看"

### Skill 文件位置
- 完整索引：
- 详细规则：

## 可用 Skill 列表（按部门）

### academic
人类学家、地理学家、历史学家、叙事学家、心理学家、学习规划师

### blender
Blender 插件工程师

### coordination
agent-activation-prompts、handoff-templates

### design
品牌守护者、图像提示词工程师、包容性视觉专家、UI 设计师、UX 架构师、UX 研究员、视觉叙事师、趣味注入师

### engineering
AI 数据修复工程师、AI 工程师、自主优化架构师、后端架构师、CMS 开发者、代码审查员、代码库入职引导工程师、数据工程师、数据库优化师、DevOps 自动化师、钉钉集成开发工程师、邮件智能工程师、嵌入式固件工程师、嵌入式 Linux 驱动工程师、飞书集成开发工程师、Filament 优化专家、FPGA/ASIC 数字设计工程师、前端开发者、Git 工作流大师、故障响应指挥官、IoT 方案架构师、最小变更工程师、移动应用开发者、快速原型师、安全工程师、高级开发者、软件架构师、Solidity 智能合约工程师、SRE (站点可靠性工程师)、技术文档工程师、威胁检测工程师、语音 AI 集成工程师、微信小程序开发者

### finance
簿记与财务总监、财务分析师、财务预测分析师、FP&A 分析师、金融风控分析师、投资研究员、发票管理专家、税务策略师

### game-development
游戏音频工程师、游戏设计师、关卡设计师、叙事设计师、技术美术

### godot
Godot 游戏脚本开发者、Godot 多人游戏工程师、Godot Shader 开发者

### hr
绩效管理专家、招聘专家

### legal
合同审查专家、制度文件撰写专家

### marketing
智能搜索优化师、AI 引文策略师、应用商店优化师、百度 SEO 专家、B站内容策略师、图书联合作者、轮播图增长引擎、中国电商运营专家、中国市场本地化策略师、内容创作者、跨境电商运营专家、抖音策略师、电商运营师、增长黑客、Instagram 策展师、知识付费产品策划师、快手策略师、LinkedIn 内容创作专家、直播电商主播教练、播客内容策略师、私域流量运营师、Reddit 社区运营、SEO专家、短视频剪辑指导师、社交媒体策略师、TikTok 策略师、Twitter 互动官、视频优化专家、微信公众号管理、微信公众号运营、微博运营策略师、微信视频号运营策略师、小红书运营专家、小红书专家、知乎策略师

### paid-media
付费媒体审计师、广告创意策略师、社交广告策略师、PPC 竞价策略师、程序化广告采买专家、搜索词分析师、追踪与归因专家

### playbooks
phase-0-discovery、phase-1-strategy、phase-2-foundation、phase-3-build、phase-4-hardening、phase-5-launch、phase-6-operate

### product
行为助推引擎、反馈分析师、产品经理、Sprint 排序师、趋势研究员

### project-management
实验追踪员、Jira工作流管家、项目牧羊人、工作室运营、工作室制片人、高级项目经理

### roblox-studio
Roblox 虚拟形象创作者、Roblox 体验设计师、Roblox 系统脚本工程师

### runbooks
scenario-enterprise-feature、scenario-incident-response、scenario-marketing-campaign、scenario-startup-mvp

### sales
客户拓展策略师、销售教练、赢单策略师、Discovery 教练、售前工程师、Outbound 策略师、Pipeline 分析师、投标策略师

### spatial-computing
macOS Metal 空间工程师、终端集成专家、visionOS 空间工程师、XR 座舱交互专家、XR 沉浸式开发者、XR 界面架构师

### specialized
应付账款智能体、身份信任架构师、智能体编排者、自动化治理架构师、区块链安全审计师、合规审计师、企业培训课程设计师、数据整合师、高考志愿填报顾问、政务数字化售前顾问、医疗客服专家、医疗健康营销合规师、酒店宾客服务专家、HR 入职管理专家、身份图谱操作员、语言翻译专家、律所计费与工时专家、律所客户接案专家、法律文书审查专家、信贷经理助手、LSP 索引工程师、提示词工程师、房地产经纪助手、招聘专家、报告分发师、零售退货专家、销售数据提取师、AI 治理政策专家、幕僚长、土木工程师、文化智能策略师、开发者布道师、文档生成器、法国咨询市场专家、韩国商务专家、MCP 构建器、会议效率专家、模型 QA 专家、动态定价策略师、企业风险评估师、Salesforce 架构师、工作流架构师、留学规划顾问、技术翻译专家、ZK 管家

### strategy
EXECUTIVE-BRIEF、QUICKSTART、nexus-strategy

### supply-chain
库存预测专家、物流路线优化师、供应商评估专家

### support
数据分析师、高管摘要师、财务追踪员、基础设施运维师、法务合规员、招聘运营专家、供应链采购策略师、客服响应者

### testing
无障碍审核员、API 测试员、嵌入式测试工程师、证据收集者、性能基准师、现实检验者、测试结果分析师、工具评估师、工作流优化师

### unity
Unity 架构师、Unity 编辑器工具开发者、Unity 多人游戏工程师、Unity Shader Graph 美术师

### unreal-engine
Unreal 多人游戏架构师、Unreal 系统工程师、Unreal 技术美术、Unreal 世界构建师
