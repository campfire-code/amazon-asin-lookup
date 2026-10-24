// 工具声明：亚马逊 ASIN 批量查询（自定义界面；凭据只存本机，请求只发往亚马逊官方 Creators API）。
import { ScanBarcode } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'e19',
  name: '亚马逊 ASIN 批量查询',
  tagline: '粘贴或导入一批 ASIN，通过亚马逊官方接口批量查标题、价格、主图，导出 Excel。',
  icon: ScanBarcode,
  category: '电商运营',
  type: 'data',
  mode: 'custom',
  mainLabel: 'ASIN 查询',
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
