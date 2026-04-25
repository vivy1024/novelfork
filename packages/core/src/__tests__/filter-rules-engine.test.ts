import { describe, expect, it } from "vitest";

import { FILTER_RULES, mapAiTasteLevel, runFilter } from "../index.js";

const positiveCases: Record<string, string[]> = {
  r01: ["综上所述，这是一段总结。", "总的来说，相关人士表示。", "需要指出的是，有关部门已经回应。"],
  r02: ["首先他醒来。其次他出门。最后他回家。", "第一，他要修炼。第二，他要炼丹。第三，他要跑路。", "一方面灵石不够。另一方面时间紧迫。"],
  r03: ["值得注意的是，以下是为您准备的内容。", "让我们一起来分析这个问题。", "不可否认的是，整体而言很完整。"],
  r04: ["他感到很开心，觉得自己很重要，认为未来会很好。", "她感到悲伤，又觉得茫然，认为无人理解。", "众人感到震惊，觉得不可思议，认为局势复杂。"],
  r05: ["他走进房间。他坐下。他开始说话。他离开房间。".repeat(20), "少年看见山。他走过河。他站在雨里。".repeat(25), "主角来到城中。主角开始修炼。主角继续前行。".repeat(20)],
  r06: ["他走了。".repeat(80), "雨停了。".repeat(80), "风来了。".repeat(80)],
  r07: ["一二三四五六七八九十。\n\n甲乙丙丁戊己庚辛壬癸。\n\n春夏秋冬东西南北天地。", "短短短短短。\n\n长长长长长。\n\n齐齐齐齐齐。", "段落长度一样。\n\n段落长度一样。\n\n段落长度一样。"],
  r08: ["体系化闭环赋能抓手机制范式模型协同沉淀路径依赖。".repeat(3), "闭环赋能抓手协同沉淀模型机制范式。".repeat(3), "范式模型机制路径依赖体系化闭环。".repeat(4)],
  r09: ["璀璨夺目绚丽多彩的光芒升起。", "深邃幽暗苍茫浩瀚的夜色压来。", "宏大壮阔璀璨夺目的宫殿出现。"],
  r10: ["他非常开心，却没有动作。", "她十分震惊，只是站着。", "众人极其重要地感到难以言喻。"],
  r11: ["“我认为这件事情需要进一步讨论。”他说。", "“综上所述，我们应当采取合理方案。”她说。", "“从某种意义上说，这是一种路径依赖。”他说。"],
};

const negativeCases: Record<string, string[]> = {
  r01: ["韩立低头，把药渣埋进土里。", "雨线斜斜打在窗纸上。", "他没说话，只把刀往袖口里藏了藏。"],
  r02: ["他先醒来，又出门，天黑才回家。", "灵石不够，时间也紧。", "一边是山，一边是河。"],
  r03: ["韩立把小瓶收进怀里。", "火光映在他脸上。", "老者咳了一声。"],
  r04: ["他咧嘴笑了笑，把铜钱塞进袖中。", "她眼眶一红，指尖攥住衣角。", "众人后退半步，没人敢看门口。"],
  r05: ["韩立咳了一声：别闹。雨砸在瓦上，老马偏要往泥里踩。".repeat(20), "啧，掌柜把算盘一推，笑得牙疼。".repeat(30), "小瓶嗡了一下。韩立眯眼：这玩意儿不对。".repeat(25)],
  r06: ["他走了。忽然，黑暗里伸出一只沾血的手，扣住他的脚踝。".repeat(10), "雨停。隔壁却响起三声锣，像催命一样。".repeat(15), "风起。少年没有回头，因为他知道回头就会死。".repeat(12)],
  r07: ["短。\n\n这一段明显更长，写了动作、声音和气味。\n\n中等长度段落。", "一声响。\n\n他看见门外站着人，那人鞋底全是泥。\n\n灯灭了。", "跑。\n\n雨水顺着屋檐往下砸，像一串断线铜钱。\n\n他低声骂。"],
  r08: ["韩立拿起药锄，沿着田埂慢慢走。", "灵石不够，他只好去坊市摆摊。", "那人咳了一口血，笑得很难看。"],
  r09: ["青光升起。", "夜色压来。", "宫殿出现。"],
  r10: ["他笑了一声，把门闩扣死。", "她一怔，茶水洒了半袖。", "众人齐齐闭嘴。"],
  r11: ["“滚。”他说。", "“你还真敢来啊？”她笑。", "“别废话，跑！”"],
};

describe("AI taste filter rules", () => {
  for (const rule of FILTER_RULES) {
    it(`${rule.id} detects positive cases and ignores negative cases`, () => {
      for (const text of positiveCases[rule.id] ?? []) {
        const hit = rule.run(text, { text, tokenized: undefined as never, priorHits: [] });
        expect(hit?.spans.length ?? 0, `${rule.id} positive: ${text}`).toBeGreaterThan(0);
      }
      for (const text of negativeCases[rule.id] ?? []) {
        const hit = rule.run(text, { text, tokenized: undefined as never, priorHits: [] });
        expect(hit, `${rule.id} negative: ${text}`).toBeNull();
      }
    });
  }

  it("maps score levels at boundaries", () => {
    expect(mapAiTasteLevel(29)).toBe("clean");
    expect(mapAiTasteLevel(30)).toBe("mild");
    expect(mapAiTasteLevel(50)).toBe("moderate");
    expect(mapAiTasteLevel(71)).toBe("severe");
  });

  it("scores human-like fixture below 30 and GPT-like fixture above 50 within 200ms", async () => {
    const humanText = "韩立把药锄扛在肩上，鞋底沾着泥。他没急着回屋，先蹲在田埂边，捻起一点发黑的土。风从山口钻下来，吹得灯笼乱晃。老仆问他要不要添饭，他摇头，只说炉火别灭。".repeat(30);
    const gptText = "首先，我们需要明确人物目标。其次，值得注意的是，以下是为您生成的章节内容。总的来说，这一段文字非常精彩、十分重要、极其动人。最后，让我们一起来进入这个宏大壮阔璀璨夺目的世界。".repeat(30);

    const human = await runFilter(humanText);
    const gpt = await runFilter(gptText);

    expect(human.aiTasteScore).toBeLessThan(30);
    expect(gpt.aiTasteScore).toBeGreaterThan(50);
    expect(gpt.elapsedMs).toBeLessThan(200);
  });
});
