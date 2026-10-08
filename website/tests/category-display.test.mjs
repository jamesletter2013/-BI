import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryDisplayName } from '../lib/category-display.ts';

test('hide the reference-date suffix for old and new captures without changing the data', () => {
  const product = { categoryPath: '餐饮具 > 餐具 > 碗（本地表参考·2020-07-27）', categorySource: '真实类目ID · 非实时官方核验' };
  const before = JSON.stringify(product);
  assert.equal(categoryDisplayName(product.categoryPath), '餐饮具 > 餐具 > 碗');
  assert.equal(categoryDisplayName('文具 > 本册 （本地表参考：2020-07-27） '), '文具 > 本册');
  assert.equal(JSON.stringify(product), before);
});

test('keep ordinary category names, parentheses and missing-data states', () => {
  for (const value of ['', '服饰 > 童装', '数码 > 配件（通用）', '碗（2020-07-27）', '本地表参考资料']) {
    assert.equal(categoryDisplayName(value), value);
  }
  assert.equal(categoryDisplayName(undefined), '');
});
