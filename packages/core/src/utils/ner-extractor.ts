/**
 * NER (Named Entity Recognition) - 命名实体识别
 * 从文本中提取人名、地名、术语、道具
 */

export interface Entity {
  text: string;
  type: 'person' | 'location' | 'term' | 'item';
  confidence: number;
}

// 常见姓氏词典（百家姓前200个）
const SURNAMES = new Set([
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨',
  '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜',
  '戚', '谢', '邹', '喻', '柏', '水', '窦', '章', '云', '苏', '潘', '葛', '奚', '范', '彭', '郎',
  '鲁', '韦', '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳', '酆', '鲍', '史', '唐',
  '费', '廉', '岑', '薛', '雷', '贺', '倪', '汤', '滕', '殷', '罗', '毕', '郝', '邬', '安', '常',
  '乐', '于', '时', '傅', '皮', '卞', '齐', '康', '伍', '余', '元', '卜', '顾', '孟', '平', '黄',
  '和', '穆', '萧', '尹', '姚', '邵', '湛', '汪', '祁', '毛', '禹', '狄', '米', '贝', '明', '臧',
  '计', '伏', '成', '戴', '谈', '宋', '茅', '庞', '熊', '纪', '舒', '屈', '项', '祝', '董', '梁',
  '杜', '阮', '蓝', '闵', '席', '季', '麻', '强', '贾', '路', '娄', '危', '江', '童', '颜', '郭',
  '梅', '盛', '林', '刁', '钟', '徐', '邱', '骆', '高', '夏', '蔡', '田', '樊', '胡', '凌', '霍',
  '虞', '万', '支', '柯', '昝', '管', '卢', '莫', '经', '房', '裘', '缪', '干', '解', '应', '宗',
  '丁', '宣', '贲', '邓', '郁', '单', '杭', '洪', '包', '诸', '左', '石', '崔', '吉', '钮', '龚',
  '程', '嵇', '邢', '滑', '裴', '陆', '荣', '翁', '荀', '羊', '於', '惠', '甄', '麴', '家', '封',
  '芮', '羿', '储', '靳', '汲', '邴', '糜', '松', '井', '段', '富', '巫', '乌', '焦', '巴', '弓',
  '牧', '隗', '山', '谷', '车', '侯', '宓', '蓬', '全', '郗', '班', '仰', '秋', '仲', '伊', '宫',
  '宁', '仇', '栾', '暴', '甘', '钭', '厉', '戎', '祖', '武', '符', '刘', '景', '詹', '束', '龙',
  '叶', '幸', '司', '韶', '郜', '黎', '蓟', '薄', '印', '宿', '白', '怀', '蒲', '邰', '从', '鄂',
  '索', '咸', '籍', '赖', '卓', '蔺', '屠', '蒙', '池', '乔', '阴', '鬱', '胥', '能', '苍', '双',
  '闻', '莘', '党', '翟', '谭', '贡', '劳', '逄', '姬', '申', '扶', '堵', '冉', '宰', '郦', '雍',
  '郤', '璩', '桑', '桂', '濮', '牛', '寿', '通', '边', '扈', '燕', '冀', '欧阳', '上官', '司马',
  '诸葛', '东方', '独孤', '南宫', '慕容', '轩辕', '公孙', '令狐', '夏侯', '皇甫'
]);

// 地名后缀
const LOCATION_SUFFIXES = [
  '山', '城', '宗', '界', '域', '府', '郡', '州', '国', '岛', '峰', '谷', '洞', '林', '海', '湖',
  '江', '河', '关', '镇', '村', '寨', '楼', '阁', '台', '殿', '宫', '院', '坊', '街', '巷', '路',
  '门', '桥', '塔', '寺', '庙', '观', '派', '教', '会', '盟', '帮', '堂'
];

// 术语后缀
const TERM_SUFFIXES = [
  '术', '法', '诀', '功', '经', '典', '道', '心法', '神通', '秘籍', '真经', '宝典', '要诀',
  '口诀', '心诀', '真诀', '妙法', '大法', '绝学', '奇功', '神功', '魔功', '仙法', '妖术',
  '咒', '印', '阵', '式', '招', '掌', '拳', '腿', '指', '爪', '剑法', '刀法', '枪法', '棍法'
];

// 道具后缀
const ITEM_SUFFIXES = [
  '剑', '珠', '鼎', '符', '令', '玉', '石', '丹', '药', '宝', '器', '镜', '钟', '塔', '旗', '伞',
  '刀', '枪', '棍', '斧', '锤', '鞭', '戟', '弓', '箭', '扇', '笛', '琴', '瑟', '笙', '箫', '鼓',
  '铃', '环', '链', '珠', '佩', '簪', '钗', '冠', '袍', '衣', '甲', '盾', '靴', '履', '带', '囊',
  '袋', '瓶', '壶', '杯', '盏', '碗', '盘', '盒', '匣', '箱', '柜', '册', '卷', '书', '图', '谱'
];

/**
 * 识别人名
 */
function extractPersons(text: string): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>();

  // 匹配 2-4 字的中文人名（姓氏开头）
  for (const surname of SURNAMES) {
    const surnameLen = surname.length;
    // 匹配姓氏 + 1-3个汉字的名字
    const pattern = new RegExp(`${surname}[\\u4e00-\\u9fa5]{1,${4 - surnameLen}}(?![\\u4e00-\\u9fa5])`, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[0];
      // 过滤：不能是地名/术语/道具后缀
      const lastChar = name[name.length - 1];
      if (LOCATION_SUFFIXES.includes(lastChar) ||
          TERM_SUFFIXES.includes(lastChar) ||
          ITEM_SUFFIXES.includes(lastChar)) {
        continue;
      }
      if (!seen.has(name)) {
        seen.add(name);
        entities.push({ text: name, type: 'person', confidence: 0.9 });
      }
    }
  }

  return entities;
}

/**
 * 识别地名
 */
function extractLocations(text: string): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>();

  for (const suffix of LOCATION_SUFFIXES) {
    // 转义正则特殊字符，匹配 2-8 字的地名（后缀匹配）
    const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`[\\u4e00-\\u9fa5]{1,7}${escapedSuffix}`, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const location = match[0];
      if (!seen.has(location)) {
        seen.add(location);
        entities.push({ text: location, type: 'location', confidence: 0.8 });
      }
    }
  }

  return entities;
}

/**
 * 识别术语
 */
function extractTerms(text: string): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>();

  for (const suffix of TERM_SUFFIXES) {
    // 转义正则特殊字符，匹配 2-10 字的术语（后缀匹配）
    const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`[\\u4e00-\\u9fa5]{1,9}${escapedSuffix}`, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[0];
      if (!seen.has(term)) {
        seen.add(term);
        entities.push({ text: term, type: 'term', confidence: 0.85 });
      }
    }
  }

  return entities;
}

/**
 * 识别道具
 */
function extractItems(text: string): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>();

  for (const suffix of ITEM_SUFFIXES) {
    // 转义正则特殊字符，匹配 2-8 字的道具（后缀匹配）
    const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`[\\u4e00-\\u9fa5]{1,7}${escapedSuffix}`, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const item = match[0];
      if (!seen.has(item)) {
        seen.add(item);
        entities.push({ text: item, type: 'item', confidence: 0.8 });
      }
    }
  }

  return entities;
}

/**
 * 从文本中提取所有实体
 */
export function extractEntities(text: string): Entity[] {
  const persons = extractPersons(text);
  const locations = extractLocations(text);
  const terms = extractTerms(text);
  const items = extractItems(text);

  // 合并并去重（优先级：person > location > term > item）
  const allEntities = [...persons, ...locations, ...terms, ...items];
  const uniqueMap = new Map<string, Entity>();

  for (const entity of allEntities) {
    const existing = uniqueMap.get(entity.text);
    if (!existing || entity.confidence > existing.confidence) {
      uniqueMap.set(entity.text, entity);
    }
  }

  return Array.from(uniqueMap.values());
}
