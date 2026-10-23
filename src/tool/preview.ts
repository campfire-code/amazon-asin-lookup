// 截图与预览用：打开后自动用演示模式（虚构的「示例」商品）跑一遍完整查询。
export const PREVIEW = { autoRun: true } as const;
export const isPreview = () => typeof location !== 'undefined' && location.pathname.endsWith('preview.html');
export const rows = () => [];
export const params = {};
