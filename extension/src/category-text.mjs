// UI commands are not category names. This guard deliberately does not reject
// ordinary words such as 数据, 商品, 收藏 or 菜单 inside real category paths.
export function isCategoryNavigationText(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\s+/g, '');
  return /更多数据|商品标题链接|SKU(?:属性|数)|店铺数据|单品透视|店铺透视|一键(?:下载|推送)|复制(?:标题|链接)|下载(?:图片|主图|详情|SKU)/i.test(text)
    || /^(?:商品数据|详情|查看详情|复制|下载|更多|进入店铺|查看店铺|清除缓存|用户信息|客服|购物车|收藏商品|收藏店铺|立即购买|加入购物车)$/.test(text);
}
