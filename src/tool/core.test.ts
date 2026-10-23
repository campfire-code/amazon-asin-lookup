import { describe, expect, it } from 'vitest';
import { chunk, explainError, getItemsBody, gridToText, marketplaceByCode, mergeRows, parseAsins, parseBatch, readPrice, tokenBody, rowToRecord, summary, maskSecret, exportFileName, backoffMs, REGIONS } from './core';
import a from './fixtures/getitems-a.json';
import b from './fixtures/getitems-b.json';

describe('解析 ASIN', () => {
  it('支持换行、逗号、空格分隔，转大写并去重', () => {
    const r = parseAsins('exampl0001, EXAMPL0002\nexampl0001  EXAMPL0003');
    expect(r.asins).toEqual(['EXAMPL0001', 'EXAMPL0002', 'EXAMPL0003']);
    expect(r.duplicates).toBe(1);
  });
  it('从商品链接里取 ASIN', () => {
    const r = parseAsins('https://www.amazon.com/Some-Name/dp/EXAMPLE001/ref=sr_1_1?x=1\nhttps://www.amazon.de/gp/product/EXAMPLE002');
    expect(r.asins).toEqual(['EXAMPLE001', 'EXAMPLE002']);
  });
  it('格式不对的放进 invalid', () => {
    const r = parseAsins('ABC\nEXAMPLE001\n太短了!');
    expect(r.asins).toEqual(['EXAMPLE001']);
    expect(r.invalid).toEqual(['ABC', '太短了!']);
  });
  it('表格内容转文本后可解析', () => {
    const r = parseAsins(gridToText([['ASIN', '备注'], ['EXAMPLE001', 1], [null, 'x']]));
    expect(r.asins).toEqual(['EXAMPLE001']);
  });
  it('空输入', () => expect(parseAsins('  \n ').asins).toEqual([]));
});

describe('请求', () => {
  it('分批每批最多 10 个', () => expect(chunk(Array.from({ length: 23 }, (_, i) => i), 10).map((x) => x.length)).toEqual([10, 10, 3]));
  it('GetItems 请求体字段与官方文档一致', () => {
    const j = JSON.parse(getItemsBody(['EXAMPLE001'], marketplaceByCode('US')!, ' demo-20 '));
    expect(j).toEqual({ itemIds: ['EXAMPLE001'], itemIdType: 'ASIN', marketplace: 'www.amazon.com', partnerTag: 'demo-20', resources: ['itemInfo.title', 'images.primary.medium', 'offersV2.listings.price', 'parentASIN'] });
  });
  it('令牌请求体', () => {
    expect(JSON.parse(tokenBody({ clientId: ' id ', clientSecret: 's', partnerTag: 't' }))).toEqual({ grant_type: 'client_credentials', client_id: 'id', client_secret: 's', scope: 'creatorsapi::default' });
  });
  it('区域令牌地址', () => {
    expect(REGIONS.na.tokenUrl).toBe('https://api.amazon.com/auth/o2/token');
    expect(REGIONS.eu.tokenUrl).toBe('https://api.amazon.co.uk/auth/o2/token');
    expect(REGIONS.fe.tokenUrl).toBe('https://api.amazon.co.jp/auth/o2/token');
    expect(marketplaceByCode('JP')!.region).toBe('fe');
  });
});

describe('响应整理', () => {
  it('itemsResult 容器：读标题、价格、无报价留空', () => {
    const r = parseBatch(a, ['EXAMPLE001', 'EXAMPLE002']);
    expect(r.items.map((i) => i.asin)).toEqual(['EXAMPLE001', 'EXAMPLE002']);
    expect(r.items[0]).toMatchObject({ title: '示例商品 一号', price: '19.99', currency: 'USD', priceText: '$19.99', parentAsin: 'EXAMPLEPAR' });
    expect(r.items[1].price).toBe('');
  });
  it('itemResults 容器与 errors 数组', () => {
    const r = parseBatch(b, ['EXAMPLE003', 'EXAMPLE004']);
    expect(r.items).toHaveLength(1);
    expect(r.errors).toEqual([{ asin: 'EXAMPLE003', message: expect.stringContaining('invalid') }]);
  });
  it('价格结构读不到时不猜', () => expect(readPrice({ foo: 1 })).toEqual({ amount: '', currency: '', text: '' }));
  it('合并：按请求顺序，区分已查到 / 未返回 / 失败', () => {
    const f = parseBatch(b, ['EXAMPLE003', 'EXAMPLE004']);
    const rows = mergeRows(['EXAMPLE004', 'EXAMPLE003', 'EXAMPLE005'], f.items, f.errors, new Map([['EXAMPLE005', '网络断开']]));
    expect(rows.map((r) => r.status)).toEqual(['已查到', '未返回', '失败']);
    expect(summary(rows)).toMatchObject({ total: 3, ok: 1, missing: 1, failed: 1, priced: 1 });
    expect(rowToRecord(rows[0])).toMatchObject({ asin: 'EXAMPLE004', price: 5.5, currency: 'USD' });
  });
});

describe('其他', () => {
  it('错误说明', () => {
    expect(explainError(401, '{"message":"invalid_client"}')).toContain('invalid_client');
    expect(explainError(403, '')).toContain('没有权限');
    expect(explainError(429, '')).toContain('频繁');
    expect(explainError(503, '')).toContain('503');
  });
  it('密钥遮盖、文件名、退避', () => {
    expect(maskSecret('abcdefghijkl')).toBe('abc••••kl');
    expect(maskSecret('abc')).toBe('••••');
    expect(exportFileName('US', new Date(2026, 9, 23, 9, 5))).toBe('亚马逊ASIN查询-US-20261023-0905.xlsx');
    expect([0, 1, 2, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 60000]);
  });
});
