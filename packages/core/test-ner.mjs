import { extractEntities } from './src/utils/ner-extractor.ts';

const testCases = [
  '张三和李四在讨论问题',
  '叶凡、萧炎、林动三人是主角',
  '青云宗位于天元城附近的玄天界',
  '他修炼了九阳神功和御剑术',
  '轩辕剑、定海神珠、炼妖壶是三大神器'
];

for (const text of testCases) {
  console.log(`\n文本: ${text}`);
  const entities = extractEntities(text);
  console.log('提取结果:', entities);
}
