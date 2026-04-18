import { describe, it, expect } from 'vitest';
import { extractEntities, Entity } from '../utils/ner-extractor.js';

describe('NER Extractor', () => {
  describe('人名识别', () => {
    it('应该识别常见姓氏的人名', () => {
      const text = '张三和李四在讨论问题';
      const entities = extractEntities(text);
      const persons = entities.filter((e: Entity) => e.type === 'person');

      expect(persons.length).toBeGreaterThanOrEqual(2);
      expect(persons.some((p: Entity) => p.text === '张三')).toBe(true);
      expect(persons.some((p: Entity) => p.text === '李四')).toBe(true);
      expect(persons.every((p: Entity) => p.confidence === 0.9)).toBe(true);
    });

    it('应该识别修仙小说中的人名', () => {
      const text = '叶凡、萧炎、林动三人是主角';
      const entities = extractEntities(text);
      const persons = entities.filter((e: Entity) => e.type === 'person');

      expect(persons.some((p: Entity) => p.text === '叶凡')).toBe(true);
      expect(persons.some((p: Entity) => p.text === '萧炎')).toBe(true);
      expect(persons.some((p: Entity) => p.text === '林动')).toBe(true);
    });

    it('应该识别复姓人名', () => {
      const text = '欧阳锋和上官婉儿是武林高手';
      const entities = extractEntities(text);
      const persons = entities.filter((e: Entity) => e.type === 'person');

      expect(persons.some((p: Entity) => p.text.includes('欧阳'))).toBe(true);
      expect(persons.some((p: Entity) => p.text.includes('上官'))).toBe(true);
    });

    it('应该过滤掉以地名后缀结尾的假人名', () => {
      const text = '张城是一座古老的城市';
      const entities = extractEntities(text);
      const persons = entities.filter((e: Entity) => e.type === 'person' && e.text === '张城');

      expect(persons.length).toBe(0);
    });
  });

  describe('地名识别', () => {
    it('应该识别常见地名后缀', () => {
      const text = '青云宗位于天元城附近的玄天界';
      const entities = extractEntities(text);
      const locations = entities.filter((e: Entity) => e.type === 'location');

      expect(locations.some((l: Entity) => l.text === '青云宗')).toBe(true);
      expect(locations.some((l: Entity) => l.text === '天元城')).toBe(true);
      expect(locations.some((l: Entity) => l.text === '玄天界')).toBe(true);
      expect(locations.every(l => l.confidence === 0.8)).toBe(true);
    });

    it('应该识别山川河流', () => {
      const text = '昆仑山下有一条黄河流过';
      const entities = extractEntities(text);
      const locations = entities.filter((e: Entity) => e.type === 'location');

      expect(locations.some((l: Entity) => l.text === '昆仑山')).toBe(true);
      expect(locations.some((l: Entity) => l.text === '黄河')).toBe(true);
    });

    it('应该识别宗门派系', () => {
      const text = '天剑派、玄武宗、青莲教三大势力';
      const entities = extractEntities(text);
      const locations = entities.filter((e: Entity) => e.type === 'location');

      expect(locations.some((l: Entity) => l.text === '天剑派')).toBe(true);
      expect(locations.some((l: Entity) => l.text === '玄武宗')).toBe(true);
      expect(locations.some((l: Entity) => l.text === '青莲教')).toBe(true);
    });
  });

  describe('术语识别', () => {
    it('应该识别功法术语', () => {
      const text = '他修炼了九阳神功和御剑术';
      const entities = extractEntities(text);
      const terms = entities.filter((e: Entity) => e.type === 'term');

      expect(terms.some((t: Entity) => t.text === '九阳神功')).toBe(true);
      expect(terms.some((t: Entity) => t.text === '御剑术')).toBe(true);
      expect(terms.every(t => t.confidence === 0.85)).toBe(true);
    });

    it('应该识别心法秘籍', () => {
      const text = '天罡诀是一部上古真经';
      const entities = extractEntities(text);
      const terms = entities.filter((e: Entity) => e.type === 'term');

      expect(terms.some((t: Entity) => t.text === '天罡诀')).toBe(true);
      expect(terms.some((t: Entity) => t.text === '上古真经')).toBe(true);
    });

    it('应该识别招式技能', () => {
      const text = '降龙十八掌、凌波微步、六脉神剑';
      const entities = extractEntities(text);
      const terms = entities.filter((e: Entity) => e.type === 'term');

      expect(terms.some((t: Entity) => t.text.includes('掌'))).toBe(true);
      expect(terms.some((t: Entity) => t.text.includes('剑'))).toBe(true);
    });
  });

  describe('道具识别', () => {
    it('应该识别神兵利器', () => {
      const text = '轩辕剑、定海神珠、炼妖壶是三大神器';
      const entities = extractEntities(text);
      const items = entities.filter((e: Entity) => e.type === 'item');

      expect(items.some((i: Entity) => i.text === '轩辕剑')).toBe(true);
      expect(items.some((i: Entity) => i.text === '定海神珠')).toBe(true);
      expect(items.some((i: Entity) => i.text === '炼妖壶')).toBe(true);
      expect(items.every(i => i.confidence === 0.8)).toBe(true);
    });

    it('应该识别丹药法宝', () => {
      const text = '他服用了筑基丹，炼化了紫金铃';
      const entities = extractEntities(text);
      const items = entities.filter((e: Entity) => e.type === 'item');

      expect(items.some((i: Entity) => i.text === '筑基丹')).toBe(true);
      expect(items.some((i: Entity) => i.text === '紫金铃')).toBe(true);
    });

    it('应该识别装备器物', () => {
      const text = '他穿着龙鳞甲，手持青龙偃月刀';
      const entities = extractEntities(text);
      const items = entities.filter((e: Entity) => e.type === 'item');

      expect(items.some((i: Entity) => i.text === '龙鳞甲')).toBe(true);
      expect(items.some((i: Entity) => i.text === '青龙偃月刀')).toBe(true);
    });
  });

  describe('混合文本识别', () => {
    it('应该从复杂文本中提取所有类型实体', () => {
      const text = `
        叶凡在青云宗修炼九阳神功，
        他手持轩辕剑，前往昆仑山寻找筑基丹。
        途中遇到了萧炎，两人切磋了降龙十八掌。
      `;
      const entities = extractEntities(text);

      const persons = entities.filter((e: Entity) => e.type === 'person');
      const locations = entities.filter((e: Entity) => e.type === 'location');
      const terms = entities.filter((e: Entity) => e.type === 'term');
      const items = entities.filter((e: Entity) => e.type === 'item');

      expect(persons.length).toBeGreaterThan(0);
      expect(locations.length).toBeGreaterThan(0);
      expect(terms.length).toBeGreaterThan(0);
      expect(items.length).toBeGreaterThan(0);

      // 验证具体实体
      expect(persons.some((p: Entity) => p.text === '叶凡')).toBe(true);
      expect(locations.some((l: Entity) => l.text === '青云宗')).toBe(true);
      expect(terms.some((t: Entity) => t.text === '九阳神功')).toBe(true);
      expect(items.some((i: Entity) => i.text === '轩辕剑')).toBe(true);
    });

    it('应该正确去重相同实体', () => {
      const text = '叶凡在青云宗修炼，叶凡很努力，青云宗很强大';
      const entities = extractEntities(text);

      const personCount = entities.filter((e: Entity) => e.text === '叶凡').length;
      const locationCount = entities.filter((e: Entity) => e.text === '青云宗').length;

      expect(personCount).toBe(1);
      expect(locationCount).toBe(1);
    });

    it('应该处理空文本', () => {
      const entities = extractEntities('');
      expect(entities).toEqual([]);
    });

    it('应该处理无实体文本', () => {
      const text = '这是一段普通的文字，没有特殊实体。';
      const entities = extractEntities(text);
      // 可能会有一些误识别，但数量应该很少
      expect(entities.length).toBeLessThan(5);
    });
  });

  describe('准确率测试', () => {
    it('整体准确率应该 ≥ 80%', () => {
      const testCases = [
        { text: '张三', expected: 'person' },
        { text: '李四', expected: 'person' },
        { text: '青云宗', expected: 'location' },
        { text: '天元城', expected: 'location' },
        { text: '九阳神功', expected: 'term' },
        { text: '御剑术', expected: 'term' },
        { text: '轩辕剑', expected: 'item' },
        { text: '定海神珠', expected: 'item' },
        { text: '叶凡', expected: 'person' },
        { text: '昆仑山', expected: 'location' },
        { text: '降龙十八掌', expected: 'term' },
        { text: '筑基丹', expected: 'item' },
        { text: '萧炎', expected: 'person' },
        { text: '玄天界', expected: 'location' },
        { text: '天罡诀', expected: 'term' },
        { text: '炼妖壶', expected: 'item' },
        { text: '林动', expected: 'person' },
        { text: '天剑派', expected: 'location' },
        { text: '凌波微步', expected: 'term' },
        { text: '紫金铃', expected: 'item' },
      ];

      let correctCount = 0;
      for (const testCase of testCases) {
        const entities = extractEntities(testCase.text);
        const matched = entities.find(e => e.text === testCase.text && e.type === testCase.expected);
        if (matched) {
          correctCount++;
        }
      }

      const accuracy = correctCount / testCases.length;
      expect(accuracy).toBeGreaterThanOrEqual(0.8);
    });
  });
});
