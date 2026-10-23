// 演示模式：不联网，按请求里的 ASIN 生成虚构商品（按文档结构编写，非真实响应）。
import type { Fetcher, FetchRes } from './api';

const res = (status: number, body: unknown): FetchRes => ({ status, text: async () => JSON.stringify(body), headers: { get: () => null } });
const NAMES = ['不锈钢保温杯', '无线蓝牙耳机', '帆布收纳包', '硅胶折叠水壶', '桌面小台灯', '快充数据线', '香薰蜡烛', '运动护腕', '陶瓷咖啡杯', '折叠雨伞', '防滑瑜伽垫', '便携挂脖风扇'];

export const demoFetcher: Fetcher = async (url, init) => {
  if (url.includes('/auth/o2/token')) return res(200, { access_token: 'DEMO', expires_in: 3600 });
  const ids = (JSON.parse(init.body) as { itemIds: string[] }).itemIds;
  const items: unknown[] = [];
  const errors: unknown[] = [];
  ids.forEach((id) => {
    const n = Number(id.replace(/\D/g, '')) || 0;
    if (id.endsWith('9')) { errors.push({ code: 'ItemNotAccessible', message: `The ItemId ${id} provided in the request is invalid.` }); return; }
    const priced = n % 5 !== 3;
    items.push({
      asin: id, detailPageURL: `https://www.amazon.com/dp/${id}`, itemInfo: { title: { displayValue: `示例·${NAMES[n % NAMES.length]}` } },
      offersV2: priced ? { listings: [{ price: { money: { amount: 9.9 + (n % 7) * 6.5, currency: 'USD', displayAmount: `$${(9.9 + (n % 7) * 6.5).toFixed(2)}` } } }] } : null,
    });
  });
  return res(200, { itemsResult: { items }, ...(errors.length ? { errors } : {}) });
};
export const DEMO_ASINS = Array.from({ length: 12 }, (_, i) => `DEMO${String(i + 1).padStart(6, '0')}`).join('\n');
