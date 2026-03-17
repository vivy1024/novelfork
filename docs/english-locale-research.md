# InkOS English Locale — Comprehensive Writing Research

This document contains all research needed to build an English prompt set for InkOS, targeting English web fiction platforms (Royal Road, Kindle Unlimited, Scribble Hub). It synthesizes genre conventions, craft rules, AI-detection patterns, and audit dimensions for automated novel writing system instruction.

---

## 1. Genre Profiles (Complete)

English web fiction has a fundamentally different genre landscape from Chinese platforms. The following 10 genres represent the core taxonomy.

### 1.1 LitRPG (Literary Role-Playing Game)

**Genre ID**: `litrpg`

**Reader Contract**: "I want to watch a character grow stronger through quantified, visible progression. I expect clear game mechanics, consistent system rules, and the satisfaction of seeing numbers improve. The system itself should be a character—rule-based, logical, and internally consistent."

**Hard Rules (Break These and Readers Leave)**
1. System consistency—once established, rules cannot change arbitrarily. Readers will catch violations reliably.
2. Visible progression—stats, levels, and skill acquisitions must be apparent. Hiding them frustrates readers.
3. Meaningful power curves—progression feels earned, not arbitrary. Too-fast = boring; too-slow = abandoned.
4. No unexplained power jumps—character growth must follow established system logic.
5. Respect reader game knowledge—many readers have played actual RPGs and identify broken mechanics immediately.

**Sub-Types**

**Crunchy vs. Lite LitRPG**
- **Crunchy**: Data-heavy, detailed stat sheets, complex skill trees, spreadsheet-like presentation. Appeals to seasoned gamers.
- **Lite/Creamy**: Minimal mechanics, narrative focus over numbers, accessible to non-gamers. Mechanics serve story.
- Reader self-selection is stark: readers often select *only* "crunchy town-builders" or "lite progression."

**VR vs. Real-World LitRPG**
- **VR**: Characters enter game worlds via headsets/pods. Clear separation between real and virtual.
- **Real-World/System Apocalypse**: Game mechanics invade Earth. All survival has mechanical weight.

**Solo vs. Guild vs. Town-Building**
- **Solo**: Single protagonist grinding and growing alone.
- **Guild**: Focus on party dynamics, team progression, faction politics.
- **Town-Building**: Base-building as primary mechanic. MC builds and manages structures, NPCs, economies.

**Other Sub-Types**
- Crafting-focused (blacksmithing, alchemy, cooking, enchanting as primary class)
- Deckbuilding (characters collect and duel with card decks)
- Harem (romance subplot with multiple love interests; contentious subgenre with explicit reader tagging)

**System Design Fundamentals**

**Stat Architecture**
- Systems typically include core stats (Strength, Dexterity, Intelligence, Constitution, Wisdom, Charisma) or custom variations.
- Derivative stats (HP, Mana) should depend on primary stats logically (e.g., HP = CON × Level).
- Successful systems maintain numerical consistency across entire narrative using spreadsheets.

**Skill Acquisition and Progression**
- Skills progress through tiers: Apprentice → Journeyman → Master, unlocking higher-tier abilities.
- Experience requirements follow exponential decay (like WoW) or linear progression with milestone spikes.
- Each skill unlock should feel *earned*, tied to genuine risk/sacrifice/problem-solving, not free gifts.

**Progression Curves** (Four Main Patterns)
1. **Linear**: Steady, slow growth. Grounded and realistic but can feel grindy.
2. **Exponential Decay**: Fast early levels, slowing dramatically. Matches MMO expectations.
3. **Milestone-Based**: Clear stages (Beginner → Base Class → Advanced Class → Tiers). Transitions have power spikes.
4. **Ranked Tiers**: Discrete jumps between ranks (Iron → Bronze → Silver → Gold) with exponential gains at each step.

**Critical Progression Rule**: Test pacing by ensuring Book 3 MC decisively defeats Book 1 version but not so overwhelmingly challenges feel trivial.

**Presenting System UI in Prose**

**Blue Box Method** (Most Common)
- Use code block formatting (Royal Road tables, monospace blocks).
- Appears after action/revelation, not mid-scene.
- Example: `[Status: Level 12 acquired] Strength: 14 → 15 Dexterity: 12 → 13`

**System Voice/Personality**
- Give the system character: formal, archaic, playful, or clinical tone.
- Consistent phrasing becomes part of worldbuilding.
- Example: System always says "Quest Accepted" vs. "Task Logged" signals flavor.

**Narrative Integration**
- Describe stats in narration first (audiobook-friendly, immersive).
- Include full stat sheet for readers who want details.
- Avoid info-dumping during action scenes.

**Key Principle**: Stat blocks should interrupt narrative tension minimally. Use them to punctuate moments of achievement.

**Common Mistake**: "Blue Box Madness"—stats every chapter, stat dumps pages long. Save reveals for meaningful moments.

**Beloved Tropes**
- Underdog rises to power
- Unique class/skill only protagonist can access
- Mentor relationship with skilled NPC
- Discovery of hidden skill/talent
- Breaking through level caps and power thresholds
- First level feels weak but rewarding

**Tired Tropes to Avoid**
- Instant mastery—character acquires skill and immediately excels
- Secret ancient power—protagonist finds item/skill no one else thought to use
- Overpowered main character—starting too strong removes tension
- Harems—if included without character work, feel tacked on
- Chosen one narrative—especially tied to destiny rather than earned power
- System message overload—too many stat dumps break immersion
- Poor female portrayal—women as "perfect girlfriend" or "sickly daughter"

**Pacing and Chapter Structure**

**Typical Royal Road Pacing**
- Chapter length: 2.8k–3.5k words is sweet spot (depends on stat density)
- Release schedule: 2–5 chapters/week (2k word chapters) or 1/week (4–8k chapters)
- Chapter structure: Opening hook/recap → Action/exploration/character moment → System interaction/stat gain → Cliffhanger/transition

**Progression Pacing**
- Early chapters: frequent level-ups and stat increases (every 1–3 chapters)
- Mid-story: level-ups every 5–10 chapters, harder to achieve
- Late story: tier/rank transitions spaced far apart, each representing massive growth

**Common Mistakes That Tank LitRPG Stories**
1. Author doesn't know the system—making up mechanics as you go
2. Info-dump syndrome—explaining system rules at length instead of revealing organically
3. Stats ≠ character development—numbers going up is hollow without emotional weight
4. Poor editing—grammar, spelling errors "absolutely KILLING this genre"
5. Uninteresting MC vs. detailed world—elaborate system, bland protagonist
6. Lack of stakes—progression without risk/difficulty
7. Unexplained power scaling—character gets stronger but readers can't track why
8. Boring skill descriptions—abilities need flavor, not just mechanical output

**Example Stories**
- **Dungeon Crawler Carl** (Matt Dinniman): Linear progression, stats tied to survival, sparse stat blocks, professional audio production, 280,000+ RR ratings
- **He Who Fights with Monsters** (Shirtaloon): Ranked tier system, unique hybrid cultivation/LitRPG mechanics, strong character voice
- **Awaken Online** (Travis Bagwell): VR LitRPG with villain-protagonist, player freedom, nearly 1M copies sold
- **The Wandering Inn** (pirateaba): Portal fantasy/isekai LitRPG, system focuses on Classes/Skills/Levels for character storytelling, 16+ million words
- **Primal Hunter** (Zogarth): System apocalypse, archer/hunter with specific identity, 11,000+ monthly patrons

---

### 1.2 Progression Fantasy

**Genre ID**: `progression`

**Core Definition**: A fantasy subgenre centered on protagonist's *intentional and quantifiable* increase in power, skill, or magical ability. The journey of growth is the primary narrative driver. Unlike LitRPG, explicit game mechanics (stats, levels) are optional; the focus is on structured, visible advancement.

**Key Distinction from LitRPG**
- **Progression Fantasy**: No game UI required. Power growth through mystical training, cultivation, martial arts, or magical cultivation. Uses words like "Rank," "Stage," "Cultivation Level."
- **LitRPG**: Game mechanics and notifications are essential parts of reading experience.
- **Overlap**: All LitRPG is technically progression fantasy, but not all progression fantasy is LitRPG.

**Reader Contract**: "Show me a protagonist learning, training, struggling to grow stronger. I want clear milestones, earned power gains, and visible transformation. The protagonist should feel fundamentally different between Act 1 and Act 3."

**Hard Rules**
1. Progress must be quantifiable—even without explicit numbers, use measurable advancement (Stage 3 cultivator, Master swordsman).
2. No power loss—progress loss scares off readers more than virtually anything else.
3. Clear power tiers—readers use these to understand world power levels. Once established, tier progression must follow logic.
4. Earned growth—power gains must connect to effort, sacrifice, or problem-solving.
5. Book-to-book comparison—Book 3 protagonist should decisively defeat Book 1 version.

**Three Major Styles**

**Eastern-Style (Xianxia/Wuxia Foundation)**
- Cultivation through meditation, qi manipulation, internal energy
- Emphasis on philosophy, enlightenment, Buddhist/Taoist concepts
- Often includes immortality seeking, heavenly tribulations
- Example: *Cradle* (western interpretation of eastern concepts)

**Western-Style Progression Fantasy**
- Borrows cultivation mechanics but strips traditional Chinese cultural trappings
- Magic systems with Western naming conventions (Copper → Iron → Jade → Gold instead of Qi Condensation → Core Formation)
- Academy settings, mentorship, adventuring parties
- Example: *Warformed: Stormweaver*

**LitRPG-Adjacent**
- Uses explicit game mechanics but emphasizes growth journey over system mechanics
- Blurs line between progression fantasy and LitRPG

**Power System Design Principles**

**Tier/Rank Systems** (Common Patterns)
- **Color Tiers**: White (beginner) → Yellow → Orange → Red → Gold (master)
- **Metal Tiers**: Copper → Iron → Bronze → Silver → Gold
- **Cultivation Stages**: Foundation → Golden Core → Immortal Ascension
- **Letter Ranks**: F (weakest) → E → D → C → B → A → S → SS

Each tier should represent *meaningful* power difference. Characters at different tiers shouldn't compete directly. Physical transformations signal mental ones: eye color, hair color, wings, horns manifest at specific tiers.

**Quantifiable Advancement** (Methods Without Explicit Numbers)
- Technique mastery (bronze-level sword strikes vs. silver-level)
- Capacity increase (can hold more mana, sustain spells longer)
- Spiritual attribute development (sensitivity to magic, intuition)
- Combat capability (can fight and win against tier X enemies)

**Training Arcs vs. Individual Breakthroughs**
- **Montage Risk**: Training montages can feel rushed. Readers want *some* individual training scenes showing struggle, failure, epiphanies.
- **Breakthrough Scenes**: When protagonist achieves tier advancement, deserves a scene showing struggle, breakthrough, transformation.
- **Best Practice**: Mix montages (covering weeks) with 1–2 detailed breakthrough scenes per tier.

**Maintaining Tension as MC Gets Stronger**

**Problem Scaling**
- Introduce enemies/challenges that scale faster or introduce different threat types
- Strongest threat need not be physical: political, magical, spiritual, temporal
- Example: *Cradle*—as Lindon grows, new factions and cultivation sects present equal or greater challenge

**Internal Struggle Escalation**
- Power doesn't solve everything. New power unlocks new problems (pride, responsibility, temptation, enemies).
- Emotional stakes must rise with power stakes.

**Shifting Power Hierarchies**
- Early story: MC is underdog among peers
- Mid-story: MC becomes formidable but others advance too
- Late story: MC among strongest but faces tier-transcending threats

**Beloved Tropes**
- Underdog from weak background
- Mentor relationship and eventual transcendence of mentor
- Breakthrough moments with dramatic transformation
- Accumulation of techniques and power combinations
- Rivalry with peer who also progresses
- Discovery of unique cultivation path/technique
- Facing the impossible and barely succeeding through growth

**Tired Tropes to Avoid**
- Instant power-up—finding an item that grants instant power
- Bloodline awakening without buildup—protagonist suddenly has latent power
- Training montage only—readers want at least some detailed training scenes
- Arbitrary advancement blocks—rules feeling like artificial gates
- Power that doesn't solve problems—progression should open new story paths

**Pacing Expectations**
- **Tier advancement**: Every 2–4 chapters early (rapid growth, high-stakes breakthroughs)
- **Mid-story**: Every 8–15 chapters (growth slowing, advancement harder)
- **Late-story**: Every 20+ chapters (major tier jumps, rare and climactic)

**Chapter Structure**
- Training/learning moment
- Application/combat testing
- Breakthrough trigger
- Advancement scene or cliffhanger

**Example Stories**
- **Cradle** (Will Wight): Western cultivation with clear tier system (Copper → Iron → Jade → Gold → Underlord). Lindon starts as "runt," cast out for weakness. New York Times bestseller.
- **Defiance of the Fall** (TheFirstDefier): System apocalypse progression fantasy with xianxia elements. 20+ million RR views.
- **He Who Fights with Monsters** (Shirtaloon): Hybrid cultivation/LitRPG with ranked advancement and strong character voice.

---

### 1.3 System Apocalypse

**Genre ID**: `system-apocalypse`

**Core Definition**: A game-like system appears in the world during an apocalyptic event, forcing characters to adapt to new reality where magic, levels, quests, and game mechanics are real. Combines LitRPG mechanics with survival fiction.

**Reader Contract**: "The world has fundamentally changed. I want to see how people adapt to supernatural/magical reality, balance survival with power fantasy, and build new society from collapse."

**Hard Rules**
1. Day Zero must matter—the inciting incident should change everything permanently. No reverting to old world.
2. Survival pressure early—early chapters must establish genuine danger. Readers want to feel stakes.
3. System integration must be logical—system arrival should have in-world explanation (however vague).
4. Real-world consistency—if system arrives on Earth, maintain real geography, real consequences.

**The "Day Zero" Opening and Conventions**

**Common Patterns**
1. Sudden integration—system appears with notification. Protagonist suddenly sees HUD, stats, quests. World immediately transforms.
2. Tutorial phase—first days/weeks are "tutorial," gentler challenges, gradual escalation.
3. Societal collapse—governments fall, infrastructure breaks, civilization shatters. Survivors must organize.
4. Factions form—within hours/days, groups form: government remnants, criminal networks, system cults, military consolidation.

**Critical Moment** (Chapters 1–3): Establish:
- How normal person reacts to system appearance
- First death or near-death (establishes real stakes)
- Understanding that old rules are gone

**Balancing Survival with Power Fantasy**

**Early Story (Chapters 1–30)**
- Focus: Survival, resource gathering, learning system mechanics
- Power fantasy is muted; MC is weak, struggles with level 1–5 monsters
- Readers want desperation, not dominance

**Mid-Story (Chapters 30–100+)**
- Focus: Growing stronger, claiming territory, power politics
- MC becomes formidable but faces tier-scaled challenges
- Power fantasy increases; survival becomes strategic

**Late-Story**
- Focus: Societal rebuilding, faction wars, world-scale threats
- MC is powerful but not unstoppable; challenges are existential/political

**Key Balance Technique**: Introduce *new* threat types as MC grows. Example: MC defeats zombies/low-tier monsters but discovers intelligent predators, rival factions, interdimensional invasions.

**Societal Collapse Portrayal**

**Essential Elements**
1. Infrastructure failure—food, water, electricity, medicine stop
2. Government vacuum—official structures collapse or fracture. Martial law or warlordism emerges.
3. Human behavior spectrum—some help, some exploit, some break. Avoid binary good/evil.
4. Resource scarcity—water, ammunition, medical supplies, safe shelter drive conflict

**Tropes**
- **Safe house**: Temporary refuge offering physical safety and mental reprieve. Often marks turning points.
- **Journey**: Group traveling through devastated landscape toward goal. Allows full-range encounters.
- **Survivor guilt/hope tension**: Characters wrestle between despair and reason to rebuild.

**Faction Building and Politics**

**Faction Types**
- Military/government remnants (organized, disciplined, possibly authoritarian)
- Criminal networks (exploit chaos, control black markets, prey on weak)
- Cults (worship the system, may sacrifice followers)
- Survival communities (towns banding together, often democratic)
- Warlords/strongmen (charismatic leaders claiming territory)
- Isolationists (avoid society, set up hidden communities)

**Political Complexity**
- Factions should have competing interests, not all evil/good
- MC becomes political player: making alliances, enemies, navigating complex webs
- Readers enjoy intrigue and political depth

**Integration of Real-World and Fantasy Elements**

**Grounding Techniques**
- Name real locations (if MC is in USA, mention states, cities)
- Acknowledge real infrastructure (highways, power lines, hospitals are now dangerous/ruined)
- Use real weapons/survival skills: firearms, first aid, agriculture, carpentry matter
- Maintain daylight cycles, weather, seasons

**Tech Integration**
- Survivors try to use old-world tech: vehicles (fuel issues), weapons (ammo), medicine
- Show why tech fails in magical world or doesn't; internal consistency matters
- Hybrids interesting: magic-powered vehicles, guns enhanced with spells

**Pacing and Chapter Structure**
- **Early (Chapters 1–15)**: Integration, confusion, first dangers. Shorter chapters (2–3k).
- **Mid (Chapters 15–50+)**: Learning system, power-up, establishing base. Varied length.
- **Late**: Expansion, war, existential threats. Can sustain longer chapters.

**Example Stories**
- **Defiance of the Fall** (TheFirstDefier): System apocalypse with cultivation elements. MC alone in wilderness. 20+ million RR views.
- **The Primal Hunter** (Zogarth): Office worker thrust into system apocalypse tutorial. Character development and progression focus.

---

### 1.4 Dungeon Core

**Genre ID**: `dungeon-core`

**Core Definition**: Protagonist is a dungeon, dungeon core, or magical construct bound to a location. Cannot leave but can reshape surroundings, create minions, set traps, grow stronger. Often pseudo-LitRPG with base-building management gameplay.

**Reader Contract**: "I want to experience strategic base-building and optimization. I accept non-human POV and limited mobility in exchange for interesting economic systems, trap design, and creature management. The dungeon itself is the protagonist."

**Hard Rules**
1. Immobility is feature, not bug—dungeon can't go on adventures. Tension comes from what threatens the core.
2. Consequence for strategic failure—if dungeon designs trap poorly or creates weak minions, adventurers will punish it.
3. Core is vulnerable—the core itself must be protected. This is central tension.
4. POV clarity—reader must understand dungeon's sensory/cognitive limitations.

**Non-Human POV Challenges**

**Sensory Limitations**
- Dungeon can't leave. Limited direct sensory input.
- Often "feels" through mana flows, monster senses, vibrations in dungeon structure.
- Dungeon learns about outside world through adventurers, scouts, or other means.

**Solution**: Split POV or relay POV.
- Primary POV: Dungeon core (strategic, omniscient within dungeon)
- Secondary POV: Adventurer, NPC, or dungeon minion exploring dungeon (reader's ground-level perspective)

This 50/50 split helps readers stay grounded in familiar human experience while experiencing dungeon's alien perspective.

**Cognitive Differences**
- Dungeon thinks slower (no human-speed consciousness)
- Dungeon might experience time differently (seasons pass in what feels like days)
- Dungeon has no human emotions (or slowly develops them)

**Base-Building Narrative Mechanics**

**Resource Management in Prose**
Instead of showing spreadsheets:
- Describe dungeon's mana reserves and regen rate
- Show cost/benefit of spawning creatures or enchanting rooms
- Create scarcity: dungeon must choose between defense, expansion, treasure hoarding

**Example Progression**
- **Early**: Simple dungeon, 3–4 rooms, basic traps, weak monsters. Dungeon learns system.
- **Mid**: Expanding territory, specialized rooms (library, forge, breeding), sophisticated trap combinations.
- **Late**: Sprawling complex, hundreds of minions, political relationships with other dungeons/factions, regional economic impact.

**Trap and Creature Design**
- Readers enjoy reading about creative dungeon design
- Each room/trap/creature should feel *purposeful*
- Show dungeon learning: "Adventurers bypassed the arrow trap by..." → "Next iteration adds reinforced walls"

**Creating Tension When MC is a Building**

**External Threat**
- Adventurer parties seeking treasure or to kill dungeon
- Rival dungeons competing for territory/resources
- Natural disasters threatening dungeon stability
- Government/military wanting to control dungeon

**Internal Tension**
- Resource scarcity: not enough mana to do everything
- Minion rebellions or dissatisfaction
- Dungeon's own curiosity/ambition creating danger
- Moral conflicts (dungeon kills adventurers; is dungeon evil?)

**Progression Tension**
- Dungeon can grow stronger, but with vulnerability windows
- Dungeon evolution/tier advancement creates periods of weakness
- New abilities come with new risks

**POV Management Best Practices**

**Single Dungeon POV** (Harder)
- Keep readers inside dungeon's perspective only
- Show external events through dungeon's limitations (hearing screams, sensing mana disturbances)
- Risk: readers feel trapped/limited
- Successful example: internal monologue and dungeon learning from observer NPCs

**Split POV** (Easier for Beginners)
- Alternate: Dungeon core chapters → Adventurer/NPC exploration chapters
- 50/50 split works well
- Adventurer chapters ground reader in familiar human perspective and build suspense

**Relay POV**
- Dungeon learns through minions' senses/reports
- Requires clear communication/understanding mechanism between dungeon and creatures
- Creates filter between dungeon and reader

**Avoiding Common Pitfalls**
1. Lone-wolf dungeon—dungeon interacts only with adventurers. Add dialogue and NPC relationships.
2. Overemphasis on adventurer POV—if 70%+ is adventurers, it's not dungeon core.
3. No consequence for design failures—make dungeon learn and adapt.
4. Reader annoyance with inability—make dungeon's strategic position interesting, not frustrating.

**Example Stories**
- **Dungeon Born** (Dakota Krout): First in Divine Dungeon series. Dungeon learns and grows, creating increasingly sophisticated challenges.
- **Rise of a Rogue Dungeon** (Royal Road): Focuses on dungeon's relationships with creatures and region.

**Chapter Structure**
- **Dungeon POV chapters**: 2–3k words. Internal monologue, planning, resource management, strategy.
- **Adventurer POV chapters**: 2–3k words. Exploration, discovery, combat, adaptation.
- **Alternating pattern**: Works well. Ends dungeon chapter on suspense (adventurers approaching); ends adventurer chapter revealing dungeon's plan.

---

### 1.5 Tower Climber

**Genre ID**: `tower-climber`

**Reader Contract**: "I want vertical progression through clearly defined floors/biomes. Each floor is a distinct challenge. Difficulty tiers are transparent. The protagonist climbs toward a known goal at the summit."

**Hard Rules**
1. Each floor must be materially different—not just cosmetic reskinning
2. Floor difficulty escalates predictably—readers should understand power requirements
3. Clear "summit" goal—readers need to know what success looks like
4. Progression is vertical, not horizontal—climber doesn't go sideways

**Chapter Structure**
- Floor introduction (new challenges, environmental detail)
- Exploration and problem-solving
- Confrontation with floor's challenge (boss, puzzle, trial)
- Advancement to next floor

**Example Stories**
- Tower climbing is common on Royal Road, often combined with LitRPG or progression fantasy

---

### 1.6 Cozy Fantasy / Slice-of-Life

**Genre ID**: `cozy`

**Core Definition**: Fantasy fiction emphasizing hope, kindness, empathy, and community. Features characters in everyday magical routines, slice-of-life elements, and low-stakes conflict. Often single-location settings (small town, inn, shop). Focus on relationships: family, found family, friendship.

**Reader Contract**: "I want comfort, warmth, and emotional connection. I'm not seeking danger or high stakes. Show me characters helping each other, building community, experiencing wonder in small magical moments. This is a refuge, not a battlefield."

**Hard Rules**
1. No genre bait-and-switch—if you promise cozy, don't introduce world-ending threat or graphic violence
2. Low stakes can still engage—conflict can exist but avoid existential threats
3. Emotional arcs over action arcs—character development happens through emotional breakthroughs
4. Community as character—setting and community are as important as individual protagonist
5. Hope must be present—even sad moments don't end in despair

**What Makes Cozy Fiction Work**

**Essential Elements**
1. Comforting details—food (tea, baked goods), comfortable spaces, sensory warmth
2. Character kindness—characters help without extensive cost/trauma. Goodness is rewarded.
3. Found family—strong relationship bonds
4. Slow pacing—space for character moments, reflection, small conversations
5. Wonder without danger—magic exists and is beautiful but not inherently threatening

**Tone**
- Conversational, intimate
- Humor is gentle, not cruel
- Authorial voice is warm, even when describing conflict

**Low-Stakes Conflict That Still Engages**

**Types of Conflict**
- Personal growth—character struggling with self-doubt, past trauma, learning to trust
- Community problem—town needs harvest before winter, shop struggling, neighborhood conflict
- Relationship tension—misunderstanding between friends, unresolved feelings, communication breakdown
- Small danger—monster in the woods (not extinction-level threat), wild magic accident
- Moral dilemma—choosing between loyalties, ethical quandary with no perfect answer

**Key Principle**: Stakes are high *emotionally* but not existentially. Character failing matters because they care, not because world ends.

**Slice-of-Life vs. Cozy Fantasy Spectrum**

**Slice-of-Life Heavy**
- Minimal plot. Emphasis on daily routines, small discoveries, character observation.
- Some readers want *no* conflict at all
- Risk: feels static or dull if no arc exists

**Cozy Fantasy with Plot**
- Clear character/community arc, gentle resolution
- Small conflicts woven through
- Most successful cozy fantasies blend both: slice-of-life texture with emotional throughline

**Best Practice**: Define upfront what "cozy" means for your story. Advertise accurately to manage reader expectations.

**Emotional Arcs in Cozy Fantasy**

**Character Arc Example**
- **Start**: Character isolated, grieving, or self-doubting
- **Journey**: Small community interactions, gradual opening to hope
- **Climax**: Emotional breakthrough (not battle)
- **Resolution**: Character healed/transformed, integrated into community

**Community Arc Example**
- **Start**: Community divided, struggling, or disconnected
- **Journey**: Characters working together on small problem
- **Climax**: Community rallies, realizes strengths in unity
- **Resolution**: Stronger bonds, shared purpose, renewed hope

**Beloved Tropes**
- Found family
- Small-town charm and quirky characters
- Magical apprenticeship/learning craft
- Healing through relationships and community
- Discovering hidden talents/purpose
- Cozy mystery elements (gentle puzzle-solving)
- Holiday/seasonal celebrations bringing community together

**Tired Tropes to Avoid**
- Manic pixie dream character—quirky character exists only to change protagonist
- Nostalgic falseness—romanticizing "simpler time"
- Conflict resolution without work—problems solve themselves
- Shallow diversity—token diverse character with no depth

**Pacing Expectations**
- Slow, meditative pacing: 2–3k chapters, weekly updates
- Space for reflection: character has time to think, feel, process
- Seasonal/cyclical structure: calendar-based (winter chapter, spring chapter) works well

**Chapter Structure**
- Quiet opening (character in routine or reflection)
- Small event or interaction
- Character's internal response/growth moment
- Gentle transition to next scene
- Soft ending (not cliffhanger; sense of peace or hope)

**Example Stories**
- **The City We Became** (N.K. Jemisin): Urban fantasy with love and community at heart
- Indie cozy fantasy web serials on Royal Road emphasizing tea shops, bakeries, magical crafts

---

### 1.7 Cultivation (Western)

**Genre ID**: `cultivation`

**Reader Contract**: "Eastern-inspired but adapted for Western audience. Meditation, martial arts, spiritual levels. I want clear cultivation stages, earned power through discipline, philosophical depth."

**Hard Rules**
1. Cultivation must feel like *work*—not instant or easy
2. Breakthrough moments should be dramatic—these mark major transitions
3. Spiritual/philosophical elements matter—meditation and inner balance are as important as power
4. Martial integration—cultivation often combines with martial arts or combat training

**Typical Cultivation Progression**
- Qi Foundation / Energy Gathering
- Qi Condensation / Core Formation
- Immortal Ascension
- Tribulation / Transcendence

**Examples**
- *Cradle* series often classified as progression fantasy but has cultivation elements

---

### 1.8 Sci-Fi / Space Opera

**Genre ID**: `sci-fi`

**Core Definition**: Space-based or futuristic fiction with science-based worldbuilding. **Hard sci-fi** emphasizes scientific accuracy and explanation of mechanics. **Space opera** prioritizes epic scale and human drama over scientific accuracy.

**Reader Contract**

**Hard Sci-Fi**: "Explain the science. I want plausible physics, technology consistency, and logical consequences of scientific principles. Handwave nothing; build the world on real science (or clear extensions of it)."

**Space Opera**: "Give me epic scale, grand conflicts, and compelling characters. Science is backdrop; human drama is foreground. Don't worry about whether FTL is physically possible; focus on the story."

**Hard Rules**

**Hard Sci-Fi**
1. Scientific consistency—physics and tech must follow established rules
2. Logical consequences—technology has realistic limitations and side effects
3. Explanation expected—readers want to understand *how* things work
4. Accuracy matters—get the science right or handwave it clearly

**Space Opera**
1. Epic scale—settings spanning planets/systems/galaxies. Civilizations clash.
2. Human drama—personal stories, political intrigue, character arcs drive story
3. Science can be soft—FTL, hyperdrives, teleports are "good enough"
4. Action and grandeur—epic space battles, first contact, exploration

**Tech Consistency Rules**

**Soft Sci-Fi Worldbuilding**
- Create internally consistent universe with its own laws of physics
- Allow divergences from reality (time travel, FTL) but rules must be consistent
- Focus on *human experience* of living with technology

**Example**: If robots can't feel emotion, they don't aid protagonist out of principle. If AI can be enslaved, show the moral implications. Rules matter.

**Tech as Extension of Rules**
- Every technology should have limitations
- Introduce problems that technology *can't* solve (corruption, emotion, nature, human greed)
- Technology solves old problems; new technologies create new ones

**Space Opera Conventions**

**Epic Scale**
- Settings span star systems to galaxies
- Civilizations and empires with histories and politics
- Grand conflicts: nations at war, first contact, existential threats

**Political Complexity**
- Factions with competing interests
- Diplomacy as important as combat
- Intrigue and betrayal common

**Exploration and Discovery**
- Unknown worlds, alien species, new phenomena
- Sense of wonder and vastness

**Military/Adventure Focus**
- Space battles, starship crews, adventuring parties
- Character-driven action

**Reader Expectations**

**Hard Sci-Fi Readers Want**:
- Believable worldbuilding
- Accurate technology/physics explanations
- Logical problem-solving
- Science as character (challenges drive plot)

**Space Opera Readers Want**:
- Epic scope and grand conflicts
- Memorable characters and relationships
- Sense of wonder
- Action and adventure
- Politics and intrigue

**Example Stories**
- **Of Blood and Stardust** (Royal Road): Military hard sci-fi space opera
- **Final War: Hetairoi** (Royal Road): Progression + hard sci-fi + mecha space opera

---

### 1.9 Romantasy / Romance

**Genre ID**: `romantasy`

**Core Definition**: Fantasy fiction where romance is a significant/primary plot driver. Reader expectations depend on which of two types:
- **Fantasy Romance**: Romance is the focus; HEA/HFN ending mandatory.
- **Romantic Fantasy**: Fantasy plot is primary; romance is significant subplot; HEA/HFN not guaranteed.

**Reader Contract (Depends on Type)**

**Fantasy Romance**: "The romance is the story. I want to see two characters fall in love against obstacles, with emotional depth and sexual/romantic tension. I expect a satisfying ending where they end up together."

**Romantic Fantasy**: "The story has a significant love arc, but the external plot is primary. I expect beautiful romantic moments and character chemistry, but the ending is determined by story logic, not romance requirements."

**Hard Rules**

**Universal to Both**
1. Chemistry must be earned—readers need to understand why characters care for each other
2. Love interest must drive transformation—significantly causes/contributes to protagonist's growth
3. Emotional honesty—inner feelings must be shown, not told
4. Conflict must be real—easy romance is boring

**Fantasy Romance-Specific**
- HEA/HFN is *required*. Readers feel betrayed if romance ends ambiguously or tragically.
- Romance scenes take significant page time (not just epilogue)
- Internal conflict (emotional journey) is as important as external conflict

**Romantic Fantasy-Specific**
- HEA/HFN is *not* required. Story logic determines ending.
- Romance thread is woven through but secondary to plot
- Reader cares about both relationship *and* external stakes equally

**Expected Tropes (Beloved)**

**Enemies to Lovers**
- Two characters start at odds: opposition, misunderstanding, or genuine enmity
- Forced proximity (war, quest, captivity) requires interaction
- Gradual understanding and attraction as they see past first impressions
- Slow-burn chemistry with banter and tension
- Works exceptionally well in fantasy: nations at war, spy dynamics, magical opposition

**Fated Mates/Chosen One**
- Characters magically bonded or destined for each other
- Internal recognition of connection
- Both resist, then accept fate
- Can feel contrived if not grounded in character choice and emotional growth

**Forbidden Love**
- Social/magical barrier preventing relationship: class difference, species difference, magic/no-magic, enemy factions
- Conflict comes from external pressure, not character incompatibility
- Relationship must prove worth the cost

**Second Chance/Forced Proximity**
- Characters separated or estranged, forced to reconcile through circumstance
- History adds depth and pain to reconciliation
- Excellent for character depth (readers see how much they've changed)

**Love Triangle**
- Two love interests, protagonist must choose
- Risky: readers often resent love triangles; only works if both are genuinely compelling
- Must be resolved decisively, not dragged out

**Character Chemistry Techniques**

**Show Attraction Subtly**
- Physical description notices: dimples, the way someone laughs, how they move
- Small touches that linger slightly longer
- Involuntary reactions: heartbeat increase, breath catching, blushing

**Banter and Wit**
- Clever dialogue showing mutual understanding
- Characters who make each other laugh or challenge each other intellectually
- Verbal sparring that masks attraction (enemies-to-lovers especially)

**Vulnerability Moments**
- Characters showing weakness or fear to each other
- Sharing secrets or past trauma
- Comforting each other (non-romantic, then gradually romantic)

**Shared Goals/Values**
- Characters discover common purpose
- Working together toward goal reveals compatibility
- Seeing how partner handles conflict/makes decisions

**Heat Levels and Reader Expectations**

**Heat Level Spectrum**
1. **Sweet (Fade-to-Black)**: Kissing, maybe embracing. Sex happens off-page. Suitable for YA, general audiences.
2. **Warm (Mild Sensual)**: On-page kissing with description. Beginning of sexual activity described. Fades to black.
3. **Sensual (Moderate Heat)**: Full sexual scenes on-page. Flowery/poetic language, not crude. 1–2 sex scenes, focus on emotion.
4. **Spicy (Explicit)**: Multiple explicit sex scenes. Coarse language acceptable. Clear anatomical descriptions. 2–4+ sex scenes per book.
5. **Erotic (Very Explicit)**: Sex scenes frequent and detailed. BDSM, kink, non-standard sexual activities. Sexual content is primary plot driver.

**Critical Rule**: Communicate heat level clearly in blurb/cover. Readers self-select. Mislabeling causes reviews from disgruntled readers.

**Romance Integration with Fantasy Elements**

**World-Building Strategy**
- Use fantasy setting to *complicate* romance (species difference adds real tension)
- Or use setting to create *opportunities* for romance (war forces proximity, magic enables bonding, politics separates lovers)
- World should not feel like afterthought to romance

**Magic and Romance Intersection**
- Magic systems can enable intimacy (magic bonds, soul connections, sensing mana intertwining)
- Or prevent it (magic and romance are separate, magic warns of danger)
- Cultural magic can influence relationship: some cultures encourage arranged bonds, others forbid cross-species love

**Action Sequences and Romance**
- Action scenes should show relationship dynamics, not pause romance
- Fighting together reveals trust, compatibility, how partners support each other
- Sexual tension can heighten during/after action (adrenaline, relief at survival, protective instincts)

**Pacing**
- **Fantasy Romance**: Heavy romance focus early, building to consummation/climax around 60–75%. Resolution after romance is established.
- **Romantic Fantasy**: Romance subplot woven through action plot. Key romantic moments at act breaks. Romance resolution aligned with plot resolution.

**Example Stories**
- **Swordheart** (Elizabeth Bear): Romantic fantasy with complex antagonists and emotional depth
- Indie romantasy web serials on Royal Road emphasizing enemies-to-lovers and character chemistry

---

### 1.10 Isekai / Portal Fantasy

**Genre ID**: `isekai`

**Reader Contract**: "MC transported to another world. Establish new world rules fast. I want to see how MC adapts, what advantages/disadvantages their origin gives them, and the clash of cultures."

**Hard Rules**
1. Avoid "tutorial town"—50 pages hitting rats kills engagement
2. Establish world rules quickly—by chapter 3, readers should understand this world's basic operating system
3. Fish-out-of-water perspective matters—show MC's cultural shock and adaptation
4. New world feels real—consistent geography, politics, cultures, not just backdrop

**Opening Conventions**
- Transportation event (summoning, reincarnation, falling through portal)
- Brief real-world grounding (who was MC before?)
- Arrival in new world and immediate disorientation
- Meeting first guide/NPC to explain world
- First concrete goal in new world

**Beloved Elements**
- Cultural fish-out-of-water comedy and drama
- MC bringing real-world skills/knowledge that apply surprisingly
- Learning new world's magic/systems
- Building relationships with new world characters
- Clash between MC's home culture and new world values

**Common Mistakes**
- Treating new world as just like Earth
- MC treating new world culture as quaint/inferior
- No real consequence for cultural misunderstandings
- Pacing too slow in "culture learning" phase

---

## 2. Core Writing Rules (Universal)

These are universal rules across all English genres. They map to the Chinese system's `buildCoreRules()`.

### 2.1 Structural Rules

1. **Write in English. Vary sentence length**—Mix short punchy sentences with longer flowing ones.
2. **Target 2,000-4,000 words per chapter**—Web serial sweet spot. Consistency matters.
3. **Every planted hook must be resolved**—No dangling threads from foreshadowing or promised mysteries.
4. **Only reference necessary context**—Don't mechanically repeat what's already established.

### 2.2 Character Rules

- **Consistency**: Behavior driven by "past experience + current interests + core personality." Never break character without cause.
- **Dimensionality**: Core trait + contrasting detail = real person. Perfect characters are failed characters.
- **No puppets**: Side characters must have independent motivation and agency. MC's strength comes from outmaneuvering smart people, not steamrolling idiots.
- **Voice distinction**: Different characters must speak differently—vocabulary, sentence length, slang, verbal tics.
- **Relationship logic**: Any relationship change (alliance, betrayal, submission) must be set up by events and motivated by interests.

### 2.3 Narrative Technique

- **Show, don't tell**: Convey through action and sensory detail, not exposition. Character ambition and values expressed through behavior, not declared.
- **Sensory grounding**: Each scene includes 1-2 sensory details (sight, sound, smell, touch, taste) beyond the visual.
- **Chapter hooks**: Every chapter ending needs a hook—question, reveal, threat, promise—to pull reader into next chapter.
- **Information layering**: Basic worldbuilding emerges through action. Key lore revealed at plot-critical moments. Never dump paragraphs of exposition.
- **Description serves narrative**: Environment descriptions set mood or foreshadow. One line is enough. No decorative purple prose.
- **Downtime earns its place**: Quiet scenes must plant hooks, advance relationships, or build contrast for upcoming conflict. Pure filler is padding.

### 2.4 Logic / Consistency

- **Three-question self-check**: For every plot beat, ask: "Why would they do this?" "Does this serve their interests?" "Is this consistent with their character?"
- **Information boundary check**: Antagonists cannot act on information they couldn't possess.
- **Event-driven change**: If MC saves someone, there must be a reason. If the villain relents, they must have been cornered.
- **Scene transitions**: No teleporting. If a character was at location A, show or acknowledge travel to location B.
- **Every paragraph earns its place**: Each paragraph must deliver new information, shift attitude, or change stakes. No empty cycling.

### 2.5 Language Constraints

- **Sentence variety**: Alternate long and short sentences. Never start three consecutive sentences with the same word or structure.
- **Verb-driven prose**: Lead with strong verbs and concrete nouns. Limit adjectives to 1-2 per sentence—make them precise.
- **Specific group reactions**: Don't write "everyone gasped." Write one or two specific characters' physical reactions.
- **Emotion through detail**: ✗ "He felt furious." → ✓ "He crushed the cup in his hand. Hot tea ran through his fingers, but he didn't flinch."
- **No meta-narration**: Never break the fourth wall or use author-commentary voice.

---

## 3. Anti-AI Rules (Iron Laws)

This is the most critical section for English. AI patterns in English are different from Chinese.

### 3.1 Iron Laws (English)

**[IRON LAW 1] The narrator never tells the reader what to conclude.**
If the reader can infer intent from action, the narrator must not state it.
- ✗ "He realized this was the most important battle of his life."
- ✓ Just write the battle—let the stakes speak.

**[IRON LAW 2] No analytical/report language in prose.**
Banned terms in narrative text: "core motivation," "information asymmetry," "strategic advantage," "calculated risk," "optimal outcome," "key takeaway," "it's worth noting," "it's important to remember."

Character inner monologue must sound like thought, not a briefing document.
- ✗ "His core motivation was survival."
- ✓ "He needed to get out. That was it. Everything else was noise."

**[IRON LAW 3] AI-tell words are rate-limited.**
The following words/phrases must not appear more than once per 3,000 words total:
- delve, tapestry, testament, intricate, pivotal, vibrant, embark, comprehensive, nuanced, landscape (metaphorical), realm (metaphorical), foster, underscore, navigate (metaphorical)
- "it's worth noting," "a testament to," "the intricacies of," "navigating the complexities"

When limit is hit, replace with concrete specific language.

**[IRON LAW 4] No repetitive image/sensation cycling.**
If the same metaphor domain appears twice (e.g., "fire coursed through his veins"), the third occurrence MUST switch to a new image or new information. No spinning in place.

**[IRON LAW 5] Six-step psychology is an internal planning tool only.**
Terms like "current situation," "core motivation," "information boundary," "personality filter" appear only in PRE_WRITE_CHECK reasoning, never in the actual chapter text.

**[IRON LAW 6] Ban the "Not X; Y" construction.**
AI overuses: "It wasn't fear. It was something deeper." / "This was no mere sword. This was a promise."
- Limit to once per chapter max.
- Rewrite as direct statement.

**[IRON LAW 7] Ban lists of three in descriptive prose.**
AI defaults to triplet constructions: "ancient, terrible, and vast" / "courage, determination, and sacrifice."
- Limit to once per 2,000 words.
- Use pairs or single precise words instead.

### 3.2 Anti-AI Example Table

#### Emotion
| AI Pattern | Human Version | Key |
|---|---|---|
| He felt a surge of anger. | He slammed the table. The water glass toppled and neither of them moved to catch it. | Action externalizes emotion |
| She was overwhelmed with sadness. | She held the phone with both hands, knuckles white, the text on screen swimming. | Physical detail replaces label |
| A chill of fear ran down his spine. | The hair on his arms stood up. His feet felt nailed to the floor. | Sensory specifics convey fear |

#### Transitions
| AI Pattern | Human Version | Key |
|---|---|---|
| However, things were not as simple as they seemed. | Yeah, right. Nothing's ever that easy. | Character voice replaces narrator hedge |
| Consequently, he decided to take action. | He stood up and kicked the chair aside. | Delete causal connectors; show the action |
| It was at that moment he realized the truth. | (Delete this sentence. The truth is in what follows.) | Don't announce revelations |

#### Filter Words
| AI Pattern | Human Version | Key |
|---|---|---|
| He saw a shadow move across the wall. | A shadow slid across the wall. | Remove "he saw" — put reader directly in the scene |
| She felt the cold wind on her face. | Cold wind bit her cheeks. | Remove "she felt" — describe the sensation directly |
| He noticed that the door was open. | The door was open. | Remove "he noticed" — just state the fact |
| He realized she was lying. | Her story didn't add up. The dates were wrong. | Replace "realized" with evidence that leads reader there |

#### Dialogue Tags
| AI Pattern | Human Version | Key |
|---|---|---|
| "I won't do it," she exclaimed defiantly. | "I won't do it." She crossed her arms. | Use "said" or action beat. Kill adverb + fancy tag combos. |
| "Interesting," he mused thoughtfully. | "Interesting." He turned the coin over in his fingers. | Action beats > dialogue tags for showing character |
| "We need to go now!" he urged desperately. | "Now." He grabbed her arm and pulled. | Urgency through brevity and action, not tag |

#### Narrator Stance
| AI Pattern | Human Version | Key |
|---|---|---|
| It was clear that the enemy had underestimated him. | (Just show the enemy's surprise through their reaction.) | "It was clear" = author lecturing |
| This would prove to be a turning point in his journey. | (Delete — let the reader feel the weight through events.) | Don't pre-announce significance |
| Little did he know, danger lurked around the corner. | (Delete — just write the danger arriving.) | Dramatic irony through structure, not narrator wink |

---

## 4. AI-Tell Word List (English)

Comprehensive list for the post-write validator (equivalent to Chinese 转折/惊讶标记词).

### 4.1 Tier 1 — Hard Flags (almost always AI when overused)
- delve, tapestry, testament, intricate, pivotal, vibrant, comprehensive, nuanced
- embark (on a journey), foster, underscore, landscape (metaphorical), realm (metaphorical)
- "a testament to," "the intricacies of," "navigating the complexities of"
- "it's worth noting," "it's important to remember," "it bears mentioning"

### 4.2 Tier 2 — Soft Flags (natural in moderation, suspicious in clusters)
- bolstered, crucial, emphasizing, enhance, enduring, highlighting, showcasing
- arguably, notably, moreover, furthermore, nevertheless
- "at its core," "in essence," "on a deeper level"
- "quiet determination," "steely resolve," "a knowing smile"

### 4.3 Tier 3 — Fiction-Specific AI Patterns
- "Not X; Y" construction (overused comparative)
- Lists of three in descriptive prose
- "Something shifted in his/her eyes"
- "The air crackled with tension/energy/power"
- "A silence hung between them"
- "His/her blood ran cold"
- "A predatory smile/grin"
- "The weight of [abstract noun] settled on his/her shoulders"
- "He/she let out a breath he/she didn't know he/she was holding"
- Excessive em-dash usage (three or more per 1,000 words)
- Alternating between purple literary prose and flat cliché sentences (the "two-mode" tell)

### 4.4 Rate Limits (Post-Write Validator)
- Tier 1 words: max 1 per 3,000 words combined
- Tier 2 words: max 3 per 3,000 words combined
- Tier 3 patterns: max 2 per chapter
- Filter words (saw, felt, noticed, realized, heard, knew, watched, seemed): max 5 per 1,000 words

---

## 5. Prose Craft Rules (for Audit Dimensions)

### 5.1 Show Don't Tell

**Core Principle**: Use sensory details and action rather than direct statements to allow readers to experience the story themselves.

**Specific Implementation**:
- Build understanding through concrete details and character behavior, not through explanatory text
- Include sensory information: what characters see, hear, smell, taste, feel
- Demonstrate emotion through physical reactions and dialogue
- Use specific actions that reveal character, motivation, and emotional state

**Example from Stephen King's Method**: Instead of "Brady is really pissed off about the detective's message," show Brady saying something between a whisper and a growl, striding in an unsteady circle, yanking his hair so hard his eyes water, kicking his chair, hunching over like a vulture.

**When Telling Is Acceptable**: Exposition at the story's beginning, after major reveals where certain details simply need clear statement, or when time constraints require narrative shortcuts. Must be used sparingly and deliberately.

**Audit Implications**: Detect excessive exposition dumps and emotional declarations that tell rather than show. Flag scenes where emotion or character state is stated directly without supporting action or dialogue.

### 5.2 Active vs. Passive Voice

**Target Ratio**: Aim for approximately 80% active voice, 20% passive voice (though this should be flexible).

**When to Use Active Voice**:
- Creates directness and clarity
- Builds reader connection to POV character
- Demonstrates character agency and forward momentum
- Generally preferred in genre fiction (fantasy, sci-fi, thrillers)

**When Passive Voice Works**:
- **Mystery/Suspense**: Conceals information the author wants to withhold
- **Creating Emphasis**: When the action or recipient matters more than the actor
- **Mood and Tone**: Can create desired atmospheric effects
- **Dialogue**: Characters may naturally use passive constructions based on voice

**Audit Implications**: Detect overuse of passive voice (>25% of sentences). Flag passive voice in action sequences or dialogue-heavy scenes unless intentional for mystery effect.

### 5.3 Adverb Usage: The Stephen King Rule and Exceptions

**Stephen King's Principle**: "I believe the road to hell is paved with adverbs, and I will shout it from the rooftops."

**Core Rule**: Minimize adverbs (words ending in -ly) because they tell rather than show—they express doubt in your ability to write strong verbs.

**Specific Applications**:

**Dialogue Tags: CRITICAL**
- ✗ Wrong: "said angrily," "whispered softly," "laughed happily"
- ✓ Right: Use stronger verbs instead ("snapped," "whispered," "chuckled")
- ✓ Better: Show emotion through dialogue content itself and action beats

**Narrative Prose**: Minimize but don't eliminate. Choose strong verbs instead.
- ✗ Wrong: "He walked slowly across the room."
- ✓ Right: "He shuffled across the room."

**King's Philosophy**: Adverbs suggest the writer lacks trust in readers' ability to understand action without explanation, or hasn't built sufficient context for readers to infer meaning.

**Exceptions**: Use adverbs only rarely and strategically—when a specific modifier truly adds irreplaceable meaning and can't be expressed through verb choice.

**Audit Implications**: Flag excessive adverbs (>3 per 500 words in narrative, any in dialogue tags). Detect adverbs in dialogue tags as automatic red flags.

### 5.4 Said-Bookism and Dialogue Tags

**The Invisibility of "Said"**: The word "said" is practically invisible to readers. The brain glosses over it instantly, allowing readers to stay immersed in dialogue.

**Why Fancy Dialogue Tags Fail**:
- Alternative verbs (exclaimed, declared, announced, insisted, asked) subtly jar readers out of the dialogue
- They draw attention to the narrator's word choice rather than the character's voice
- They interrupt story immersion

**Professional Standards**:
- Use "said" and "asked" as defaults
- Replace some tags entirely with action beats (physical actions showing how something is said)
- If emotion/tone isn't clear from dialogue content and context, the dialogue itself needs rewriting, not a fancy tag

**Example Fix**:
- ✗ Wrong: "I hate this," she said angrily.
- ✓ Right: "I hate this." She slammed the door.

**Audit Implications**: Flag dialogue tags other than "said" and "asked" as violations. Detect adverbs in dialogue tags as automatic failures. Encourage action beats over dialogue tags.

### 5.5 Purple Prose Detection

**Definition**: Overly elaborate, self-indulgent writing that prioritizes the sound of words and ornate descriptions over clarity and pacing.

**Red Flag Characteristics**:
- Excessive adjectives modifying nouns
- Multisyllabic, flowery language that calls attention to itself
- Exaggerated metaphors and similes
- Long, winding sentences that obscure meaning
- Overwrought emotional descriptions
- Language feels melodramatic or divorced from the story's needs

**Examples of Purple Prose**:
- "Her laughter was a symphony of spring rain, golden sunlight, and wind in the trees." (Better: "Her laughter was like a rain shower—quick and unexpected.")
- "The tall, brooding, mysterious stranger walked solemnly and silently across the desolate, fog-laced, moonlit street." (Better: "The stranger drifted down the fog-laced street, quiet and unreadable.")
- "He was consumed by a soul-crushing, bone-deep anguish that shattered him into a million irreparable fragments." (Better: "His gut dropped—and kept dropping. He sank to his knees, tried to speak, but what could he say?")

**Root Causes**:
- Weak verb choices compensated for with adjectives
- Unclear story logic compensated for with lyrical language
- Attempting to sound literary rather than telling the story effectively

**Audit Implications**: Detect clusters of 3+ adjectives modifying single nouns, elaborate metaphors that overshadow action, ornate language that obscures meaning. Flag inconsistency between prose style and genre expectations (flowery prose in action-heavy sci-fi).

### 5.6 Filter Words

**Definition**: Unnecessary words that separate reader from character experience, creating distance between the reader's experience and the character's POV.

**Common Filter Words**: assumed, believed, considered, decided, felt, heard, knew, looked, noticed, observed, perceived, realized, revealed, saw, seemed, sounded, thought, understood, watched, wondered.

**Why They Weaken Writing**: Filter words add an extra layer of narration between reader and character consciousness, reducing immediacy and deep POV.

**Examples and Fixes**:
- "She noticed two snakes fighting in the rocks." → "In the rocks, two snakes were fighting."
- "He heard footsteps in the hall." → "Footsteps echoed down the hall."
- "She felt light-headed and gripped the door frame." → "Light-headed, she gripped the door frame."
- "He saw the gun in her hand." → "The gun was in her hand."

**When They're Acceptable**: Rarely. Sometimes a filter phrase's simplicity is the right choice if removing it creates awkwardness, but this should be exceptional.

**Audit Implications**: Detect filter words, especially in first-person or deep third-person POV. Flag filter word usage >1 per 500 words. In deep POV sections, filter words are particularly problematic.

### 5.7 Sentence-Level Rhythm and Structure Variation

**Core Principle**: Monotonous sentence structure creates monotonous reading. Vary sentence length and structure to create rhythm that engages readers.

**Fundamental Technique**: Mix short and long sentences.
- **Short sentences**: Create pace, urgency, emphasis, impact
- **Long sentences**: Slow pace, allow complexity, build atmosphere
- **Medium sentences**: Balance and flow

**Application to Genre Fiction**:
- **Action scenes**: Predominately short-to-medium sentences create speed and tension
- **Dialogue scenes**: Varied lengths reflect natural conversation rhythm
- **Introspection**: Longer sentences can show character processing, but vary throughout
- **Quiet moments**: Short sentences can paradoxically create tension through restraint

**Rhythm Techniques**:
- Vary sentence length systematically, not randomly
- Use parallel structure for emphasis or connection
- Employ repetition strategically for rhythm and memorability
- Use punctuation to guide pacing and emphasis

**Effect on Reader**: Rhythm paces the reader, emphasizes ideas, creates mood, and maintains engagement.

**Audit Implications**: Detect paragraphs where all sentences are roughly the same length. Flag action scenes dominated by long sentences. Detect monotonous rhythm in dialogue. Check that pacing (sentence length) matches scene intensity.

### 5.8 Paragraph Structure by Scene Type

**Principle**: Paragraph breaks are tools for controlling pacing.

**Short Paragraphs**:
- Create faster visual pace
- Make eyes move down page quickly
- Best for: action scenes, dialogue with tension, rising stakes
- Effect: reader perceives speed and momentum

**Long Paragraphs**:
- Slow visual pace
- Allow detailed exploration
- Best for: introspection, world-building, description, emotional depth
- Effect: contemplative mood, thoughtfulness

**Dialogue Heavy Scenes**:
- Break up long dialogue exchanges with physical action or internal thought
- Use the Rule of Three: after three lines of dialogue, insert a beat of action/emotion/narration or switch speaker

**Genre Expectations**:
- **Action/Thriller**: Frequent paragraph breaks, mostly short paragraphs
- **Fantasy**: Balanced, varied—short for action, longer for world detail
- **Web Serial**: Very short paragraphs (cliffhangers every 1,500–2,000 words), frequent breaks for pacing

**Audit Implications**: Flag excessive paragraph length in action scenes. Detect long stretches of dialogue without breaks or action beats. Check paragraph structure matches scene intensity and genre conventions.

---

## 6. Scene Craft

### 6.1 Scene Structure: Goal-Conflict-Disaster / Reaction-Dilemma-Decision

**Framework Origin**: Developed by Dwight V. Swain in "Techniques of the Selling Writer."

**THE SCENE (Action)**:

**Goal**:
- Characters have scene-level objectives distinct from the overall plot goal
- The goal drives action forward
- Creates clarity about what's at stake in this moment

**Conflict**:
- Series of obstacles preventing the character from reaching the goal
- Tests the character's determination
- Shows how badly the character wants the goal
- Builds momentum and reader engagement

**Disaster**:
- Failure to achieve the goal
- Not necessarily catastrophic, but significant enough to change future outcomes
- Has stakes and consequences
- Creates the "page-turner" effect

**THE SEQUEL (Reaction)**:

**Reaction**:
- Character absorbs and processes the disaster's emotional impact
- Shows how the disaster affects the character
- Gives emotional weight to story events
- Creates space for character humanity

**Dilemma**:
- Presents the question: "What do I do now?"
- Shows the character's options and their costs
- Builds tension through uncertainty
- Raises stakes for next action

**Decision**:
- Character makes a choice among options
- Becomes proactive again (not passive)
- Leads directly to the next scene's goal
- Creates momentum

**Momentum Building**: These elements chain together—disaster leads to reaction, reaction to dilemma, dilemma to decision, decision to new goal, creating an engine that drives readers through the story.

**Audit Implications**: Check scenes have clear goals. Detect scenes with no conflict or stakes. Flag scenes ending in success without consequences (no disaster). Verify reaction sequences exist after major events. Check decision/choice drives next scene.

### 6.2 Scene Transitions and White Space

**Transition Types**:
- **No transition**: Scene continues naturally in same location/time
- **White space**: Blank line break indicating time/location shift
- **Narrative bridge**: Brief transitional prose explaining time/location shift
- **Chapter break**: Major structural transition

**White Space Function**:
- Signals passage of time or change of location
- Gives readers breathing room
- Prevents "white room syndrome" (feeling of floating in undefined space)
- Creates pacing through visual breaks

**Best Practices**:
- Use white space for obvious transitions (time/location changes)
- Vary transition methods to avoid monotony
- Ensure reader always knows where/when scene is set
- Use transitions to control pacing (frequent transitions = faster feel; fewer = slower)

**Audit Implications**: Check scenes have clear setting/time establishment. Flag scenes that seem to exist in undefined space. Verify transitions match story pacing needs.

### 6.3 Action Scene Pacing and Clarity

**Key Elements**: Goals, Pacing, Clarity, Character

**Clarity First**:
- Readers must understand what's happening
- Avoid confusing or over-complicated choreography
- Visualize the scene completely before writing
- Use clear cause-and-effect
- Simpler action sequences are often more gripping than complex ones

**Sentence Structure for Action**:
- **Short and medium sentences**: Build pace and excitement
- **Avoid hundred-word sentences**: Kills momentum
- **Fragment usage**: Sparingly, for impact
- **Adjective/adverb usage**: Ruthlessly eliminate; find strong verbs and nouns instead

**Visual Layout**:
- Blank space on page creates impression of fast pace
- Smaller paragraphs make eyes move down page faster
- Dense paragraphs slow reading

**Character and Stakes**:
- Show internal reaction of active character
- Readers care about characters; action without emotional investment feels hollow
- High stakes make action meaningful
- Character emotion creates tension readers feel

**Pacing Rhythm**:
- Vary pace: scene after scene of breakneck action becomes tedious
- Predictable patterns (slow/fast/slow/fast) also weaken
- Mix in moments of reflection between action peaks
- Physical and emotional arcs should complement each other

**Audit Implications**: Flag overly complex action descriptions. Check action scenes don't average >15 words per sentence. Verify character perspective and emotion present in action. Detect action scenes with no stakes or character investment.

### 6.4 Dialogue Scene Construction and Beats

**Understanding Beats**:
- Beats are the smallest units of structure that push narrative forward
- Can include actions, events, emotional shifts, or conversations
- Represent micro-level action/reaction between characters
- Prevent "floating head syndrome" (dialogue with no grounding)

**Action Beats**:
- Insert physical action, gesture, or environmental interaction between dialogue lines
- Break monotony of dialogue-only exchanges
- Show character reaction non-verbally
- Add setting detail and grounding
- Example: "I can't do this anymore." She buried her head in her hands.

**The Rule of Three**:
- Whenever a character speaks three lines of dialogue, switch speaker, insert an action beat, show emotion, or use brief narration
- Prevents long unbroken dialogue blocks
- Maintains reader's sense of visual/physical reality

**Talking Heads Problem**:
- Dialogue with no action, setting, or non-verbal reaction
- Readers can't visualize scene or characters
- Lacks grounding in physical reality
- Feels like screenplay rather than novel prose

**Dialogue Construction Requirements**:
- Each exchange must turn the beats of the scene
- Must sound like natural talk
- Should reveal character, advance plot, or both
- Must include sensory grounding and physical presence

**Audit Implications**: Flag long dialogue exchanges without action beats or setting details. Detect scenes that could be "talking heads." Verify action beats use varied verbs and create character understanding.

### 6.5 Fight Scene Writing

**Core Tension**: Mechanics of fights are often boring; the experience is vivid and terrifying. Good writing transforms mechanical action into gripping experience.

**Clarity Over Choreography**:
- Readers must understand what's happening (priority #1)
- Over-detailed choreography confuses and slows pace
- Detailed step-by-step feels mechanical, not gripping
- Focus on key movements and character reactions

**Visceral, Sensory Language**:
- Sounds: impacts, grunts, gasps, silence
- Smells: blood, sweat, fear
- Tactile: impact on body, pain, exhaustion
- Emotional: fear, adrenaline, desperation
- Make reader *feel* the fight, not just see it

**Pacing Structure**:
- Short to medium-length sentences work best
- Complement swift nature of battle
- Build pace and tension
- Avoid long, complex sentences that slow reading

**Character and Stakes**:
- Fight scenes without character work feel hollow
- Readers must know what losing means
- High stakes make tension matter
- Show protagonist's limitations and vulnerabilities

**Rhythm and Variation**:
- Don't sustain maximum intensity throughout
- Mix moments of intensity with brief pauses
- Show character fatigue and recovery
- Create emotional climax, not just physical action

**Audit Implications**: Check fight scenes are visually clear. Detect over-complicated choreography. Verify sensory language present. Check stakes are established. Flag fight scenes without character perspective.

### 6.6 Emotional and Quiet Scenes

**Principle**: Stillness can be loaded with emotion, meaning, and tension—but only if you charge it properly.

**Building Emotional Weight in Stillness**:
- Know what's at stake beneath the calm
- Emotion must show through nonverbal communication
- Body language, micro-reactions, tiny movements are gold
- Show what character won't or can't say

**Techniques**:

**Controlled Emotion**:
- Express strong feeling through implication rather than declaration
- Show how emotion alters behavior, environment, pacing, dialogue
- Pressure building is more powerful than emotion venting immediately
- Restraint often feels heavier than explosion

**Prose Structure**:
- Keep prose lean; let each line land
- Avoid over-explaining
- Use white space as friend
- Short paragraphs and intentional line breaks
- Silence and stillness are active, not passive

**Nonverbal Elements**:
- Dialogue with room to breathe
- Fractured sentences showing disrupted thinking
- Sensory detail: temperature, texture, light
- Physical positioning and distance between characters

**Transformation Requirement**:
- Even if scene is physically still, something must shift
- Realization, decision, loss, intimacy, understanding
- Best quiet moments are transformational
- Show change in character's emotional or psychological state

**Audit Implications**: Check quiet scenes aren't emotionally flat. Verify nonverbal communication shows emotion without stating it. Detect over-explaining. Flag scenes without transformation or emotional arc.

---

## 7. Character Craft

### 7.1 Deep POV and Character Voice

**Definition of Deep POV**: Most intimate, closest writing style where reader experiences story as if inside the character—feeling what they feel, experiencing what they experience, hearing their thoughts, without distance.

**Creating Deep POV**:
- Character's immediate sensory perceptions and reactions
- Character's internal thoughts and emotional responses
- Character's interpretation of events (not omniscient narrator's)
- Filter out authorial distance
- Immerse reader in character's moment-to-moment experience

**Character Voice Components**:
- **Sentence structure**: Reflects how character thinks and speaks
- **Vocabulary**: Reveals education, background, region
- **Rhythm and accent**: Distinctive speech patterns
- **What character notices**: Emphasizes their priorities and concerns
- **What character omits or avoids thinking about**: Shows internal conflict
- **Personal opinions and biases**: Reveals character worldview

**First-Person Voice**:
- Narrator voice carries throughout
- Every word reflects character's perspective
- Personality shines through word choice and rhythm
- Readers know character intimately through voice

**Third-Person Deep POV**:
- Narrative uses third person but filtered through character's perception
- Narrator adopts character's vocabulary and syntax
- Character's internal voice becomes the prose voice
- Maintains emotional intimacy despite third person

**Establishing Voice Quickly**:
- Characters should be distinguishable by voice alone
- Readers should know POV character from random page opening
- Voice consistency across scene/chapter
- Assessment words reveal character desire/fear ("probably," "fortunately," "weirdly," "disastrously")

**Audit Implications**: Check voice is consistent within character's POV. Detect authorial intrusion (narrator voice differs from character voice). Verify character voice is distinct if multiple POV characters. Flag filter words as distance-creating.

### 7.2 Head-Hopping and POV Breaks

**Definition**: Jumping from one character's head to another's within the same passage—typically mid-scene or mid-chapter, not at scene/chapter breaks.

**Why It's Problematic**:
- Breaks immersion—hauls readers out of narrative
- Reader loses sense of whose story it is
- Creates confusion about perspective
- Reminds readers they're "being told" a story
- Breaks reader trust in author's authority

**How It Happens**:
- POV switches within scene without clear break
- Revealing one character's thoughts immediately followed by another's
- Shifting to external description that narrator couldn't access
- Revealing information no POV character could know

**Professional Standards**:
- Multiple POV characters are acceptable
- Switch only at scene breaks or chapter breaks
- Scene has one POV character throughout
- If switching POV characters, use clear structural signals (chapter break, section break)

**Detection and Fixing**:
- Color-code scenes by POV during revision
- Use writing software (Scrivener, Dabble) to tag POV
- Keep POV log during drafting
- Check each paragraph for POV consistency
- Verify all thoughts/internal reactions belong to current POV character

**Audit Implications**: Flag POV shifts within scenes without breaks. Detect thoughts/knowledge that don't belong to current POV character. Verify clear structure when switching POV characters.

### 7.3 Character Motivation and Agency

**Character Agency Definition**: Character's ability to make decisions and affect the story; has own motivations; is active more than reactive; pushes plot more than plot pushes them.

**Passive vs. Active Protagonists**:
- **Passive**: Go with flow, make no decisions, don't affect story, always one step behind
- **Active**: Make story what it is, drive narrative forward, make meaningful choices

**Agency Components**:

**Motivation (Motive)**:
- What character wants
- Why they want it
- Must be something they'll take risks to get
- Should connect to main story goals

**Capacity**:
- Character must have ability to pursue the goal
- Doesn't mean guaranteed success, but means they can try meaningfully
- Includes skills, resources, willingness, determination

**Goals and Choices**:
- Scene-level goals drive immediate action
- Story-level goals drive overall arc
- Character must make consequential choices
- Choices drive story forward

**Overcoming Passivity**:
- Give character strong goal connected to main story
- Ensure character has motivation to chase it
- Character must take action and make decisions in pursuit of goal
- Create situations where character's agency matters

**Audit Implications**: Verify protagonist has clear motivation. Check character has capacity to pursue goals. Flag passive protagonists who let plot happen to them. Detect scenes where character makes no meaningful choices.

### 7.4 Character Voice Consistency and Differentiation

**Establishing Voice Quickly**:
- Characters should be distinguishable by voice alone (vocabulary, sentence length, verbal tics)
- Readers should know POV character from random page opening
- Voice consistency across scene/chapter

**Voice Differentiation Methods**:
- Vocabulary level (educated vs. street)
- Sentence length (terse vs. verbose)
- Verbal tics and catchphrases (used sparingly)
- What they notice (a thief spots exits; a merchant spots goods)
- How they process stress (humor, anger, withdrawal, analysis)

**Audit Implications**: Verify all characters don't sound like author or each other. Check vocabulary matches character background. Flag inconsistent voice within same character's POV.

---

## 8. Dialogue Craft

### 8.1 Natural Dialogue Rules

**Core Principle**: Dialogue is heartbeat of fiction, breathing life into characters and driving narrative forward.

**Observational Techniques**:
- Listen to real conversations
- Note quirks, filler words, rhythms
- Observe how people talk in different contexts
- Notice ebb and flow, interjections, interruptions, unfinished sentences
- Pay attention to regional differences, age-based speech, education markers

**Building Character Voice**:
- Understand character's personality, education, background, age
- Vocabulary reveals education level ("gonna" vs. "going to"; "ain't" vs. "isn't")
- Word choice reflects region
- Slang and dialect reveal group membership
- Speech patterns reflect mental state

**Testing Dialogue**:
- Read aloud to check natural flow
- Hearing words helps identify awkward phrasing, unnatural rhythm
- Reveals inconsistencies in character voice
- Easier to spot overused phrases when heard

**Purpose and Function**:
- Dialogue must do work: reveal character, convey information, show plot happening
- Each conversation should reveal something about characters or advance plot
- Dialogue shouldn't exist just to move exposition

**Avoiding Common Errors**:
- Don't have all characters sound like author
- Don't give every character complex speech patterns (some characters speak simply)
- Don't use dialogue for information that's better in narration
- Don't write how people actually talk (ums, ahs, false starts) constantly—suggest it, don't replicate it

**Audit Implications**: Check dialogue sounds natural when read aloud. Verify character voices are distinct. Detect all characters sounding similar. Check dialogue serves plot/character purpose.

### 8.2 Subtext in Dialogue

**Definition**: The conflict between what's said aloud versus what character is thinking, feeling, wanting, or hiding.

**Importance**: Strong dialogue is supported by subtext; surface meaning differs from underlying truth.

**Creating Subtext**:
- **Evasion**: Character says one thing while implying another
- **Contradiction**: Actions/thoughts contradict dialogue
- **Hesitation**: Pauses, fragments, avoiding direct answer
- **Coded language**: Saying something innocuous while meaning something else
- **Disagreement between words and emotion**: Saying positive things with angry tone

**Mismatch Between Dialogue and Action/Thought**:
- Character says "I'm fine" while shaking
- Character claims happiness while hunched and quiet
- Character agrees while jaw clenches
- Character swears they don't care while eyes betray them

**Achieving Subtext**:
- Don't state hidden emotion directly
- Show through nonverbal cues
- Use action beats to reveal what words hide
- Let readers infer underlying truth
- Create gap between surface and depth

**Example**:
- Surface dialogue: "That's wonderful. I'm happy for you."
- Subtext shown through: Flat tone, looking away, fingers clenching, hesitation before response

**Audit Implications**: Check dialogue has underlying meaning beyond surface words. Verify subtext shown through action beats and tone, not stated. Detect flat dialogue without hidden layers.

### 8.3 Banter and Humor

**Banter Definition**: Quick, witty dialogue exchange showing character rapport and intellectual compatibility.

**Creating Effective Banter**:
- Characters understand each other—they can finish each other's thoughts
- Humor reveals character intelligence and personality
- Banter shows relationship dynamics without exposition
- Works especially well for enemies-to-lovers (sexual tension through verbal sparring)

**Humor in Dialogue**:
- Character humor reveals voice and personality
- Humor can be dark, witty, physical, or self-deprecating—match character
- Timing is crucial (banter-heavy dialogue loses punch if every line is a quip)
- Balance humor with serious moments or it becomes exhausting

**Audit Implications**: Check banter doesn't overshadow plot. Verify humor matches character voice. Detect forced quips that seem out of character.

### 8.4 Dialogue Tags vs. Action Beats

**Understanding the Difference**:

**Dialogue Tags**:
- "he said," "she asked," "they replied"
- Identify speaker
- Most effective when invisible

**Action Beats**:
- Character performs action while speaking
- Shows how something is said through action
- Reveals character, emotion, physicality
- Breaks up dialogue blocks visually

**Why Action Beats Work Better Than Fancy Tags**:
- Fancy tags draw attention ("she exclaimed," "he declared")
- Action beats show rather than tell emotion
- Create visual variety
- Ground dialogue in physical reality
- Show character behavior revealing inner state

**Examples**:
- Tag: "I hate this," she said angrily.
- Action beat: "I hate this." She slammed the door.

- Tag: "Where are you going?" he asked nervously.
- Action beat: "Where are you going?" He fumbled for his keys, missing twice before getting them right.

**Rules for Action Beats**:
- Use varied verbs (not just "she did X")
- Action should reflect emotional state and character
- Action can show setting detail
- Don't use action beats artificially
- Use enough to break up dialogue; not so much it bogs down pacing

**Audit Implications**: Check dialogue uses "said/asked" rather than fancy tags. Detect long stretches of dialogue without action beats. Verify action beats use varied verbs and reveal character.

---

## 9. Audit Dimensions (English Adaptations)

Many Chinese dimensions carry over directly. These are the ones that need English-specific changes or are new to English.

### 9.1 Dimensions That Change Significantly

| Dimension | Chinese | English Adaptation | Notes |
|----------|---------|-------------------|-------|
| 语言流畅度 | 句式重复/"了"字连用 | Sentence variety, filter word density, passive voice ratio (target <20%), adverb density | Chinese checks "了" overuse; English checks "-ly" adverb overuse and passive voice |
| AI味检测 | 仿佛/不禁/宛如 | Tier 1-3 AI-tell word clusters (see section 4) | Completely different word lists |
| 题材疲劳词 | Per-genre Chinese clichés | Per-genre English clichés (see below) | Need new cliché lists per genre |
| 对话真实度 | 说话风格区分 | Said-bookism check (fancy dialogue tags), adverb-tag combos, talking-head syndrome | English has its own dialogue craft rules |
| 代入感/沉浸 | 五感描写 | Filter word check (he saw/she felt/he noticed), POV consistency, head-hopping detection | English "deep POV" is a key craft concept |

### 9.2 Genre-Specific Fatigue Words

**LitRPG / Progression Fantasy:**
- "A notification appeared" (overused system interaction)
- "His eyes widened" (overused surprise)
- "Power surged through him" (generic power-up)
- "He smirked" (overused facial expression)
- "Time seemed to slow" (overused combat moment)
- "A new skill had been acquired" (passive system notification)
- "He could feel himself getting stronger" (tell, not show)

**System Apocalypse:**
- "The world had changed" (overused post-apocalypse opener)
- "Survival of the fittest" (cliché philosophy)
- "He had to get stronger, fast" (generic urgency)
- "Trust was a luxury" (tired cynicism)

**Cozy / Slice-of-Life:**
- "A warm feeling spread through his chest" (overused warmth)
- "Home. He was finally home." (overused arrival)
- "The aroma of fresh bread filled the air" (generic comfort)

**Romance / Romantasy:**
- "Her heart raced/skipped a beat" (overused physical reaction to attraction)
- "A flutter in her stomach" (overused nervous attraction)
- "He couldn't look away" (overused attraction description)
- "Chemistry crackled between them" (overused sexual tension)

---

## 10. Chapter Structure Conventions

### 10.1 Web Serial Chapter Structure (Royal Road / KU)

| Element | Chinese Web Novel | English Web Serial |
|---------|------------------|-------------------|
| Chapter length | 2,000-4,000 chars | 2,000-4,000 words |
| Opening | Hook within first 3 paragraphs | Hook within first 3 paragraphs (same) |
| POV | Usually third-person limited | First-person (most popular for LitRPG/progression) or third-person limited |
| Tense | Past tense | Past tense (present tense occasionally for first-person) |
| Chapter ending | Cliffhanger/hook | Hook but NOT always cliffhanger — "soft hooks" (unanswered question, new information, emotional shift) preferred over constant danger cliffhangers |
| Stat/System UI | N/A | Use sparingly — milestone snapshots, not every-chapter dumps. Format in monospace/code blocks. |
| Author's Note | Rarely | Common at end of chapter (keep out of word count) |

### 10.2 The "First 5 Chapters" Rule

English web serial readers decide within 5 chapters whether to continue. These chapters must:
1. Introduce the MC with a clear personality voice (not a blank slate)
2. Establish the core genre promise (if LitRPG, show the system by chapter 2-3)
3. Present a concrete problem or goal
4. Minimize characters (2-3 max)
5. Skip prologue/backstory dumps — start in action or consequence

### 10.3 Hooks and Engagement

Web serial readers expect every chapter click to be "earned." Best practices:
- End chapters at a point of new information or raised stakes, not after resolution
- Don't overuse danger cliffhangers — they exhaust readers. Mix with:
  - Mystery hooks (new information raises questions)
  - Promise hooks (MC commits to a plan the reader wants to see executed)
  - Relationship hooks (dynamic shifts between characters)
  - Revelation hooks (reader learns something the MC doesn't, creating dramatic irony)

### 10.4 POV Conventions

**First Person** (dominant in LitRPG / Progression)
- MC's voice must be distinct and consistent — vocabulary, humor, worldview
- Inner monologue should sound like actual thought, not narration
- ✗ "I assessed the tactical situation and determined my optimal course of action."
- ✓ "Two exits. One guard on the left, half asleep. The window was my best bet."
- Limit self-aware commentary ("I'm not going to lie, that hurt" is fine once; not every page)
- First-person does NOT mean the narrator describes their own appearance in mirrors

**Third Person Limited**
- Stay in one POV per scene. Head-hopping between characters mid-scene breaks immersion.
- Deep third-person: describe only what the POV character would notice and in the way they would describe it
- A scholar character notices different details than a street fighter

### 10.5 Stat Block / System UI Formatting (for LitRPG)

When the story includes game-like system elements, format them distinctly from prose:

**Stat Blocks** (use sparingly)
```
╔══════════════════════╗
║  Name: Kai Ashford   ║
║  Level: 14           ║
║  Class: Stormcaller  ║
║  HP: 340/340         ║
║  MP: 180/210         ║
╚══════════════════════╝
```

**Notifications** (inline)
> **[System]** Skill acquired: *Minor Flame Ward* (Rank F)

**Rules for System UI**
1. Show full stat blocks only at major milestones (level-up, class change, arc end)
2. Inline notifications only when narratively significant
3. Never end a chapter with a stat dump
4. System text should have its own "voice" — terse, mechanical, possibly with personality
5. MC's reaction to system text matters more than the text itself

---

## 11. Pre-Write Checklist (English Version)

Maps to Chinese `buildPreWriteChecklist()`. The checklist structure stays the same, content adapts:

### 11.1 PRE_WRITE_CHECK Format

```
=== PRE_WRITE_CHECK ===
OUTLINE_ANCHOR: [Which plot node from the volume outline does this chapter advance?]
GENRE_PROMISE: [What genre expectation does this chapter fulfill? (e.g., meaningful power-up, system reveal, character growth)]
HOOK_RESOLUTION: [Which pending hooks from previous chapters are addressed?]
NEW_HOOKS: [What new hooks will this chapter plant?]
POV_CHARACTER: [Whose perspective? What's their current emotional state?]
SIX_STEP_PSYCHOLOGY:
  - Situation: [What does the POV character face right now?]
  - Motivation: [What do they want most? What do they fear?]
  - Information: [What do they know? What are they wrong about?]
  - Personality: [How does their personality shape their response?]
  - Choice: [What will they do?]
  - Expression: [How will they show it — body language, voice, action?]
PACING_NOTE: [Is this chapter action/tension/quiet/transition? How does it fit the arc rhythm?]
WORD_TARGET: [2,000-4,000 words]
TENSION_CHECK: [Does this chapter escalate stakes or raise new questions?]
CHARACTER_CHECK: [Does this chapter reveal something about the POV character not previously known?]
ANTI_AI_CHECK: [No Tier 1 AI words > 1 per 3,000? No repetitive metaphors? No "not X; Y" constructions > 1? No lists of three > 1 per 2,000?]
```

---

## 12. Common Mistakes to Detect

### 12.1 Head-Hopping
Jumping between characters' thoughts within a scene without clear breaks. Breaks immersion; confuses whose story it is.

### 12.2 Info Dumps / "As You Know Bob"
Characters explain information they would naturally know, just so reader learns it. Unnatural and breaks dialogue.

Example:
- ✗ "As you know, Bob, the system arrived three years ago and changed everything."
- ✓ Cut this entirely, reveal through action or let reader infer.

### 12.3 Deus Ex Machina
Sudden solution to problem that wasn't set up or earned. Reader feels cheated.

Example:
- ✗ MC is trapped, suddenly discovers an escape route that was never mentioned before.
- ✓ Plant the escape route earlier so reader could theoretically predict it.

### 12.4 Mary Sue / Gary Stu
Perfect character with no flaws, who is always right, never fails, is loved by everyone.

Red flags:
- Character has no genuine weaknesses
- Character never loses a conflict
- Side characters exist only to admire main character
- Character doesn't grow/change (no arc)

### 12.5 Plot Armor
Character survives situations that would kill ordinary people through authorial fiat, not established mechanics or ingenuity.

Example:
- ✗ MC falls off a cliff, survives with no explanation.
- ✓ MC either trained for falls, has armor, or the fall wasn't as high as implied.

### 12.6 Talking Heads
Dialogue with no action, setting detail, or character grounding. Feels like screenplay, not novel.

Fix:
- Add action beats
- Ground in sensory detail
- Show character body language
- Include physical reaction to dialogue

### 12.7 White Room Syndrome
Scene exists in undefined, featureless space. Reader can't visualize setting.

Example:
- ✗ They stood and talked for hours. (Where? What does it look like? Can they see anything?)
- ✓ They stood in the tavern corner, the smell of spilled beer and woodsmoke thick around them. The bartender glanced at them occasionally but minded his business.

### 12.8 Protagonist Without Agency
Character is passive, reacts to events, doesn't make meaningful choices, plot happens *to* them rather than through them.

Fix:
- Give character clear motivation/goal
- Character makes consequential choices
- Character's actions drive plot forward
- Character faces real obstacles, not trivial ones

### 12.9 Consistency Violations
Character behaves inconsistently with established personality/abilities without justification.

Example:
- MC is established as cautious, but then takes reckless action without motivation.
- System is established as consistent, but then breaks its own rules for plot convenience.

### 12.10 Purple Prose / Over-Description
Flowery, overwrought descriptions that prioritize sound over clarity and pacing.

Example:
- ✗ "The crystalline azure sky, resplendent with golden rays of scintillating sunlight, stretched across the vast, boundless expanse, evoking sensations of profound sublimity and ethereal wonder."
- ✓ "The sky was clear and bright."

---

## 13. Serial Fiction-Specific Considerations

### 13.1 Episodic Structure
- Thrive in serialized markets
- Cliffhangers every 1,500–2,000 words standard
- Word count consistency important (readers expect similar episode lengths)
- Each installment has mini-arc while contributing to larger narrative

### 13.2 Reader Retention Principles
- Episode-level resolution crucial (readers return when feeling rewarded, not stalled)
- Cliffhangers effective but not always dramatic
- Can be emotional cliffhangers (investing in character struggle)
- Unresolved questions keep readers curious
- Physical peril, plot twists, personal decisions all work as cliffhangers

### 13.3 Planning and Structure
- Some form of outline necessary for multi-episode stories
- Working with multiple storylines stretched over episodes requires game plan
- Each installment should resolve something while opening new questions
- Pacing differs from completed novel (slower burn acceptable in serial)

### 13.4 Reader Experience
- Readers develop habit of checking for new chapters
- Consistent publication schedule matters
- They remember details across gaps between episodes
- Emotional investment builds over time

---

## 14. Synthesis: The Five Pillars of English Web Fiction Quality

Based on all research, the following five pillars define quality English web fiction:

### Pillar 1: Internal Consistency
- Systems/magic/rules follow their own logic, never breaking established rules for plot convenience
- Characters behave consistent with established personality (with earned development)
- World details remain consistent across narrative
- Reader can trust the author to follow the rules

### Pillar 2: Earned Progression and Stakes
- Character growth is earned through struggle, sacrifice, or clever strategy
- Power-ups and achievements have meaningful cost
- Success has weight because failure had real consequences
- Reader feels protagonist *earned* victories, not stumbled into them

### Pillar 3: Character-Driven Narrative
- Characters are intelligent, multi-dimensional, with genuine agency
- Plot happens *through* character choices and actions, not *to* them
- Side characters have independent motivation and presence
- Reader cares about people first, systems second

### Pillar 4: Clarity and Immersion
- Reader always knows where/when they are (no white room syndrome)
- Action is clear and visualizable
- POV is consistent and deep
- Reader stays immersed through clear prose, not jarred by authorial intrusion

### Pillar 5: Engagement and Pacing
- Each chapter has a hook—question, revelation, emotional shift, or raised stakes
- Pacing varies (action, quiet moments, exposition) to maintain rhythm
- Reader feels compelled to read the next chapter
- Scene structure follows goal-conflict-disaster/reaction-dilemma-decision

---

## 15. Sources

### Genre Research
- [Strategies For Success Releasing LitRPG Stories On Royal Road](https://johnchampaign.com/2024/01/29/strategies-for-success-releasing-litrpg-stories-on-royal-road/)
- [Royal Road Forum: Difference between progression fantasy and litrpg](https://www.royalroad.com/forums/thread/156327)
- [Royal Road Forum: LitRPG Think Tank](https://www.royalroad.com/forums/thread/100306)
- [LitRPG Power Arc Analysis by C.R. Rowenson](https://crrowenson.com/case-studys/litrpg-power-arc-analysis-case-studies/)
- [How to Write LitRPG - LitRPG Reads](https://litrpgreads.com/blog/litrpg/how-to-write-litrpg-integrating-game-systems-into-your-story-without-losing-readers)
- [Blue Box Madness - Joi Massat](https://jmassat.com/2024/02/13/blue-box-madness-or-the-dark-side-of-writing-litrpgs/)

### Craft and Writing Instruction
- Stephen King, "On Writing"
- Brandon Sanderson Writing Lectures
- Writing Excuses Podcast
- Mythcreants Writing Craft Guides
- Robert McKee, "Story"
- Dwight V. Swain, "Techniques of the Selling Writer"

### AI Detection and Anti-Slop
- [How to Identify AI-Written Web Fiction](https://recordcrash.substack.com/p/how-to-identify-ai-written-web-fiction)
- [Plus AI: Most Overused ChatGPT Words](https://plusai.com/blog/the-most-overused-chatgpt-words)
- [Why Does ChatGPT "Delve" So Much? (ACL 2025)](https://aclanthology.org/2025.coling-main.426/)
- [Royal Road Forum: AI-Generated Stories Detection](https://www.royalroad.com/forums/thread/163455)
- [Mythcreants: Nine Reasons to Reject AI Slop](https://mythcreants.com/blog/dont-fall-for-ai-nine-reasons-for-writers-to-reject-slop/)

### Publishing and Platform Research
- [LitRPG Reads: LitRPG in 2026 vs 2016](https://litrpgreads.com/blog/litrpg/litrpg-novels-2026-vs-litrpg-books-in-2016-what-a-decade-changed)
- [Level Up Publishing: How to Write LitRPG](https://www.levelup.pub/how-to-write-litrpg)
- [Royal Road: What Makes a Good LitRPG](https://www.royalroad.com/forums/thread/97990)
- [Royal Road: Chapter Length Discussions](https://www.royalroad.com/forums/thread/103370)

---

## Appendix A: Reddit & Community-Sourced Supplements (March 2026)

The following material was gathered from Reddit (r/litrpg, r/progressionfantasy, r/writing, r/royalroad), Royal Road forums, Goodreads discussions, and key blog posts from genre authors (Andrew Rowe, etc.). It supplements the main research sections above.

### A.1 LitRPG — Reader Pet Peeves & Community Consensus

**System Design (from Royal Road forums & Goodreads polls)**
- "People don't need to know how every aspect of the system works by chapter 10." Integrate system info through character dialogue with natural breaks and humor, not dense exposition blocks.
- Generic systems kill reader retention — ~20% of readers abandon after 3 chapters due to boring mechanics. Add distinctive features (high pain percentages, hyper-realism, transferable knowledge).
- Use mathematical formulas for stat calculations and maintain them in spreadsheets. Example: `(Level × 100) + (10 × VIT) = MaxHP` with class modifiers and racial traits.
- Make the game "playable" — readers should think "I'd actually play this." Include system updates/patches to refresh mechanics.
- "If it is a game or has a system, it is going to have an order to it." Everything should be explainable, even if details are withheld for reveals.

**Common Reader Complaints (from Goodreads LitRPG Forum polls)**
- Info-dumping system details at every opportunity
- "Big blue stat blocks" that don't add narrative value — readers want systems interwoven into story, not spreadsheet dumps
- MCs succeeding because they discover what millions of players obviously would have found
- All races/NPCs acting like modern humans instead of reflecting their cultures
- MCs breaking the entire game system without consequences

**Contributor Tips**
- Give races and NPCs distinct personalities reflecting their culture/religion
- Include "what if" scenarios: magic-immune enemies, legendary classes that are actually weak (farmer/sculptor), cursed weapons
- Consider player ecosystems — if a broken build exists, other players would have found it first
- Not all LitRPGs need deep mechanics — some work better with light system references

### A.2 Progression Fantasy — Andrew Rowe's Framework (Expanded)

**Three Progression Styles** (from "Distinctions in Progression Fantasy Styles"):
1. **Numeric Levels**: Numbered advancement (Level 1-99). Impact depends on granularity — 1-20 system makes each level significant; systems reaching thousands dilute individual importance.
2. **Titled Levels**: Named tiers like "Copper → Iron → Jade → Gold" (Cradle). More thematic, requires broader power gaps between stages.
3. **Relative Progress**: Growth shown through character comparison rather than absolute measurement (Mother of Learning, Mage Errant).

**Power Differential Design**:
- **Large Gaps**: Satisfying power fantasy but risks making supporting characters irrelevant. "Punching above weight" can feel cheap.
- **Moderate Gaps (~1.5-2x per level)**: Arcane Ascension model. Lower-level characters can compete under specific circumstances. Best for group stories.
- **Asynchronous Scaling**: Different attributes improve at different rates. Guardians gain strength; Menders don't. Maintains specialization value.

**Critical Advice from Andrew Rowe**:
- "If a character jumps from Level 1 to Level 99 in a single book, that doesn't really serve the same purpose." The journey IS the appeal.
- "The feeling that power increases are being earned" is essential. Gifts/luck-based progression feels unsatisfying.
- "Other People Should be Competent and Believable." Supporting characters shouldn't seem incompetent.
- "Adding something new to a character's list of abilities is more interesting than just a straight power increase." New abilities > stat boosts.
- "If progression exists, your antagonists may also be progressing." Creates unique challenges.
- Be extremely careful giving out super speed, teleportation, and time travel — they trivialize obstacles.
- "Avoid doing things like that" when introducing progression mechanics that characters then ignore without reason.

**Progress Loss**: Most readers strongly dislike losing advancement. Even resets (roguelikes, time loops) should involve knowledge retention. Permanent losses alienate audiences unless narratively justified.

**Organic vs. "Cheats"**:
- Organic: Normal advancement rate (Forge of Destiny, Arcane Ascension). Grounded but slower.
- Cheats: Unique advantages accelerating progression (Iron Prince's 20x faster growth, time chambers, exclusive classes). Some readers demand cheats; others prefer organic.

### A.3 AI Writing Detection — Extended Tell List

**From "How to Identify AI-Written Web Fiction" (Makin/RecordCrash)**:

Macro-level patterns:
- Repetitive sentence structures ("the droning sound") that human writers naturally vary
- Tonal oscillation: swings between "long, heavy comparisons, then short lines that sound like stock phrases"
- Lack of stylistic evolution — maintains mechanical consistency rather than developing organic variation

Micro-level tells:
- **Negation constructions**: Overuse of "not X; Y" structures (e.g., "It was no current. It was a summons")
- **Lists of three**: Excessive triplet enumeration ("a geometry of madness, a wound in the fabric of what is, older than law and time")
- **Blocky dialogue**: Conversations separate dialogue, exposition, and narration into discrete chunks rather than weaving them
- **Punctuation quirks**: Heavy emdash usage → newer models substitute semicolons/commas with similar syntactic patterns
- **Metaphor saturation**: Multiple descriptors targeting single concepts in final sentences (tryhard density)
- **Eyeball kicks**: Overly specific sensory descriptions disconnected from narrative purpose

**Extended AI Overused Word List** (from GitHub gist + Plus AI research):

Tier 1 — Instant Red Flags (>100x human frequency):
delve, tapestry, testament, camaraderie (162x), palpable (95x), underscore, intricate, intricacies, vibrant, beacon, meticulous, meticulously, embark, gossamer, crucible, labyrinth, indelible, unwavering, whimsical, virtuoso

Tier 2 — Strong Signals:
bolster, bustling, championing, commendable, compelling, cutting-edge, daunting, enigma, enlightening, exemplified, foster, multifaceted, nuanced, profound, resonates, reverberate, spearheaded, symphony, transcended, transformative, treasure trove, unveil

Tier 3 — Structural Phrases:
"a testament to", "at the end of the day", "deep dive", "dive into", "drill down", "fear not", "game changer", "hustle and bustle", "important to note", "it's worth noting that", "key insights", "little did", "shed light", "that being said", "unique blend"

**Fiction-Specific AI Patterns** (beyond word-level):
- "Every time ChatGPT tries to write a grief scene, it sounds like a Hallmark card"
- Character name "Elara" appears suspiciously often
- "Barely above a whisper" and "otherworldly glow" as default descriptions
- "Gray goo" storytelling: technically competent yet emotionally disengaged
- Monotone, uninspired prose with imprecise wording
- Excessive exposition causing pacing issues and tonal misalignment

### A.4 Deep POV — 17-Point Framework (Lisa Hall-Wilson)

Key practical takeaways for InkOS English prompts:

1. Deep POV is a strategic tool, not for entire manuscripts — blend with other techniques for pacing
2. Every word originates from the character's perspective with zero narrator intrusion
3. Remove filter words: "thought", "knew", "realized", "wished", "saw", "heard", "felt"
4. Goes beyond emotion words — includes description choices, word selection, what the character notices/ignores
5. Character voice prominence — every word reflects worldview, prejudices, priorities
6. Best applied during revision (Phase 2 settlement in InkOS terms)
7. Information access limitations create natural tension — readers know only what POV character knows
8. Works across most genres (romance, mystery, suspense, fantasy)
9. Emotion writing is the hardest part — layering emotional complexity authentically = mastery
10. "Show don't tell" intensified — not just actions but what the character perceives and ignores

### A.5 Royal Road — Rising Stars Strategy & Serial Fiction Mechanics

**Launch Mechanics**:
- Need 20k words minimum for Rising Stars eligibility
- Most authors dump first 10 chapters on day one, one hour apart
- Once on RS, you're there for max 30 days
- For a "true blue RS run," have 60 chapter backlog (10 day-one + 30 daily + 20 buffer)
- Algorithm relies on snowball of views in first few days → RS amplifies into avalanche

**Traffic Sources** (from Top 25 RS author):
- Ads: ~700 users (1.7% CTR)
- Shoutouts: ~500 users (free)
- RS visibility: ~400 users
- Main page: ~200 users
- Favorites and follows rank higher than reviews for algorithm

**Consistency is Everything**:
- Most common schedule: Monday/Wednesday/Friday
- Daily releases show seriousness and build initial readership fast
- Extremely short chapters (1,000-1,500 words) allow daily releases without burnout

**Community Building**:
- Name your fanbase
- Respond to every comment
- Gamify with progress bars and milestone-based bonus chapters
- Ask readers for input on story decisions

**Reader Segmentation**:
- Some won't read until massive chapter count exists
- Others only read completed stories
- Many prefer ongoing serials with consistent updates

### Sources (Appendix A)

- [Andrew Rowe: Writing Progression Fantasy](https://andrewkrowe.wordpress.com/2019/03/02/writing-progression-fantasy/)
- [Andrew Rowe: Distinctions in Progression Fantasy Styles](https://andrewkrowe.wordpress.com/2022/11/04/distinctions-in-progression-fantasy-styles/)
- [Royal Road Forums: Sharing LitRPG Tips and Tricks](https://www.royalroad.com/forums/thread/100248)
- [Royal Road Forums: Top 25 Rising Stars — Lessons Learned](https://www.royalroad.com/forums/thread/148967)
- [Royal Road Forums: How to Land on Rising Stars](https://www.royalroad.com/forums/thread/141030)
- [Goodreads: LitRPG Reader Problem Poll](https://www.goodreads.com/topic/show/19548378)
- [How to Identify AI-Written Web Fiction (RecordCrash/Makin)](https://recordcrash.substack.com/p/how-to-identify-ai-written-web-fiction)
- [ChatGPT Overused Words — GitHub Gist](https://gist.github.com/chrisgherbert/c734ec50ae464135be57cd03b84281f9)
- [Plus AI: Most Overused ChatGPT Words](https://plusai.com/blog/the-most-overused-chatgpt-words)
- [Lisa Hall-Wilson: 17 Things About Deep POV](https://lisahallwilson.com/17-things-to-know-about-deep-pov/)
- [Royal Road Forums: What's a Good Release Schedule](https://www.royalroad.com/forums/thread/155967)

## Appendix B: Extended Research — Reddit, AI Communities & Practitioner Blogs (March 2026)

Sources: r/ClaudeAI, r/writing, r/selfpublish, r/NovelAI, r/Sudowrite, r/ChatGPT, Royal Road forums, Kindlepreneur, NovelMage, CRAFT Literary, RecordCrash Substack, SFF Chronicles, Roll for Narrative.

### B.1 Active English Communities for AI Fiction Writing

**Reddit — AI-focused writing communities:**
- **r/ClaudeAI** — Active discussion of Claude for long-form fiction, system prompts, and project-based workflows
- **r/NovelAI** — Dedicated to NovelAI tool (proprietary "Kayra" model, custom AI Modules trained on specific genres/authors, uncensored output)
- **r/Sudowrite** — Sudowrite users sharing fiction workflows (Story Bible feature, trained on published novels not Wikipedia)
- **r/ChatGPT** — Broad AI discussion, includes fiction writing threads; model limitations discussion
- **r/selfpublish** — Practical AI integration; 60/40 split favoring AI use; focus on Kindle/RR publishing
- **r/writing** — General writing community; hybrid AI approach most praised; "bouncing ideas off a limitless co-writer"
- **r/rational** — Rational fiction community; intelligent characters solving problems with creative applications of knowledge
- **r/HFY** (Humanity, Fuck Yeah) — Speculative fiction community with AI protagonist discussions

**Reddit — Genre communities:**
- **r/litrpg** — Genre-specific discussion, reader complaints, trope analysis
- **r/progressionfantasy** — Craft advice, what readers hate, pacing rules
- **r/Fantasy** — Broader fantasy discussion including web fiction
- **r/royalroad** — Platform-specific strategy, release schedules, reader engagement

**Non-Reddit communities:**
- **Royal Road Forums** — Most authoritative source for serial fiction craft; cliffhanger techniques, Rising Stars strategy, genre expectations
- **Scribble Hub Forum** — Secondary web fiction platform; LitRPG approach advice
- **SFF Chronicles** — Serious discussion of why writing LitRPG is harder than people think
- **Sufficient Velocity / SpaceBattles** — Quest fiction and rational fiction communities
- **Goodreads LitRPG Forum** — Reader polls on common problems; consumer perspective

### B.2 Claude-Specific Fiction Writing Workflow (from Kindlepreneur & NovelMage)

**7-Step Claude Novel Process (Kindlepreneur):**
1. **Brainstorm** — "Give me [N] high-concept pitches for a bestselling [GENRE] story with a unique twist"
2. **Synopsis** — 3-act structure synopsis with detailed beat breakdown
3. **Characters & Worldbuilding** — Character profiles + city/location/map documents uploaded to Claude Project
4. **Outline** — Expand synopsis using preferred structure (Hero's Journey, Save the Cat, etc.)
5. **Story Beats** — 12+ action beats per chapter; **use proper nouns instead of pronouns** for clarity
6. **Style Guide** — "First person past POV, show don't tell, deep POV" as foundational instruction
7. **Prose Generation** — Write 2-3 beats at a time with full context (genre, tone, POV, setting, characters)

**Key insight**: Claude's 200K-token context window allows uploading entire outlines + character bibles + previous chapters simultaneously.

**NovelMage Anti-Generic Strategies:**
- Upload writing samples to train on your unique style preferences
- Use "Writer's Voice" features to ensure suggestions feel authentically yours
- Maintain comprehensive character/world databases (Codex Systems) for consistency
- Plan sessions beforehand to eliminate blank-page paralysis

### B.3 What Reddit Says Works vs. Fails in AI Fiction

**What Works (from r/writing, r/selfpublish, r/ChatGPT):**
- **Pre-draft assistance**: Test plot twists and thematic comparisons before writing
- **Scene scaffolding**: AI generates rough dialogue that writer substantially revises
- **Comparative generation**: Produce multiple AI versions of same scene, cherry-pick strongest elements
- **Lightweight editing**: Simplify overwritten passages during revision
- **"Three endings" technique**: "I let ChatGPT write my chapter ending three different ways so I could pick the best one"
- **Constraints > freedom**: "When Claude has specific rules, it follows them and output sounds human. When it can write 'anything,' it writes nothing memorable."

**What Fails (community consensus):**
- **Emotional flatness**: "Every time ChatGPT tries to write a grief scene, it sounds like a Hallmark card"
- **Repetitive patterns**: Models loop ideas and add excessive exposition, creating pacing issues
- **Generic prose**: "Technically competent, yet emotionally disengaged" without strong direction
- **"AI tone"**: "Clean but not convincing" — lacks the small redundancies, rhythm, and phrasing humans use
- **Default telling**: "ChatGPT defaults to telling over showing because it's responding to a prompt directly; by design, it cannot be oblique or indirect"
- **Purple prose gravity**: Models favor ornate language requiring explicit "simplify" prompts

### B.4 Show Don't Tell — AI's Core Weakness (from CRAFT Literary)

**The fundamental problem**: AI tools "cannot produce the kind of subtlety, nuance, and intentional obliqueness that characterizes our best prose."

**Bad (AI-typical)**:
> "A peaceful day at a pond is a serene and tranquil experience, where nature's beauty unfolds before your eyes."

This summarizes rather than shows. Tells readers what to feel instead of presenting specific sensory details.

**Actionable Rules for InkOS Prompts:**
1. **Select details intentionally** — Include only specifics that serve both plot and deeper significance
2. **Omit direct answers** — Use subtext in dialogue; characters need not directly respond to each other
3. **Leverage silence** — "The scene's poignancy lies in the space between the characters' lines"
4. **Embed meaning implicitly** — Let details speak for themselves rather than explaining significance
5. **Avoid summary language** — Don't articulate emotions or themes; illustrate through action
6. **Choose surprising adjectives** — Instead of "gentle breeze," use unexpected modifiers unique to your scene

### B.5 LitRPG Writing — Extended Craft Rules (from Roll for Narrative, SFF Chronicles, Royal Road)

**Core Principle**: "Once you introduce a system, you don't just write a story anymore; you start managing an economy, a physics model and emotions at the same time."

**Stats as Seasoning, Not the Meal:**
- ❌ "Strength +3, Dexterity +2"
- ✅ "He swung harder than before, his strike landing with enough force to send the goblin skidding backward"

**System Consistency Trap**: "Every single gain, loss, reward, punishment, shortcut, loophole, and emotional beat must be consistent. Readers watch your math, logic, and consequences."

**Spreadsheet Fiction Warning**: "If your protagonist spends more time explaining their inventory than actually using it, you might be entering spreadsheet fiction."

**Character Stakes > Numbers**: Give characters personal stakes — their arc should be more than getting to max level. Choices should matter. "The +5 Sword belonged to Meredith's father. Should I keep it knowing I'd stolen something that wasn't mine?"

**The Lived-In World Test**: NPCs should have independent agendas. "A blacksmith argues with suppliers about prices; an innkeeper funds a rebellion—neither involves the hero directly."

**Pacing Rules:**
- Don't hand out power for free — Demon Lord should be Chapter 5+ victory, not Chapter 2
- Compress grinding efficiently: "Three days of training later, my legs felt like lead, but my dodges were faster"
- Interrogate every mechanic: Does this choice advance the story? If a skill upgrade doesn't mean something for character development, strategy, or challenges, there are no stakes

### B.6 Serial Fiction Chapter Endings (from Royal Road Forums)

**Five Cliffhanger Techniques:**
1. **Raise stakes or questions** — End on heightened peril or new mysteries
2. **Close calls** — Near misses, foiled plans, almost reunions
3. **Interrupt key moments** — Stop right before confession, kiss, or confrontation
4. **Reversals** — A victory becomes a defeat unexpectedly
5. **End on dialogue** — Halt a tense conversation on a dramatic line

**Critical Balance**: "If you have a cliffhanger every chapter, it's the same as not having them at all." Overuse diminishes impact.

**Soft Hooks vs. Hard Cliffhangers**: Not every chapter needs danger — unanswered questions, new information, and emotional shifts work as engagement drivers without artificial tension.

**Platform-Specific Warning**: Cliffhangers frustrate readers when chapters release infrequently. Pair cliffhanger intensity with release schedule reliability.

### B.7 Progression Fantasy — Andrew Rowe Extended (from blog posts)

**Magic System Specialization**: Characters should progress differently. Rather than Dragon Ball Z's approach (overall power increases everything uniformly), separate advancement in speed, strength, and resilience. Example: "Keras' 'Body of Stone' technique makes him stronger and more resilient, but at a cost to his speed."

**Meaningful Weaknesses**: Must be relevant to combat style. "Physical weakness as a wizard has to be fairly extreme for it to serve as a major detriment." Avoid immediately solving weaknesses — they should represent long-term development goals.

**Emotional Catharsis Power-Ups**: Can work (Stormlight Archives, Sailor Moon) when properly set up beforehand, but feel "super cheesy if it feels arbitrary and unearned."

**Society-Level Power Application**: "Any Power Available to Society Should be Applied by Society." If resurrection exists, important people ensure access. Teleportation revolutionizes trade. Elemental magic transforms agriculture. Address how existing power structures utilize abilities.

**The Options Principle**: "Adding something new to a character's list of abilities that they can actively take advantage of is more interesting than just a straight power increase." A conditional backstab attack engages readers more than "+2% critical hit rate."

### B.8 AI Detection Extended — Structural Patterns (from RecordCrash, CRAFT, Reddit)

**Machine Voice Rhythms**: Inconsistent cadence between "loquacious ponderous similes and tiny sentences made out of cliches" — artificial alternation rather than organic style development.

**Contextual Poisoning**: Once AI reaches a "local minimum of samey cliches," it won't self-correct. Human writers instinctively vary word choices when noticing repetition; AI has the opposite instinct.

**Character Name "Elara"**: Appears suspiciously often in AI fiction. Also watch for: Kael, Lyra, Theron, Seraphina.

**Default Descriptions to Ban**: "barely above a whisper," "otherworldly glow," "eyes that held/held the weight of," "a dance of [noun]," "the air crackled with"

**"Gray Goo" Storytelling**: Technically competent yet emotionally disengaged. The prose equivalent of watching a movie with the sound off — all the visual information is there but none of the feeling.

### Sources (Appendix B)

- [Kindlepreneur: How to Write a Book in Claude](https://kindlepreneur.com/claude-ai/)
- [NovelMage: Claude 4 for Writers](https://novelmage.com/blog/claude-4-for-writers-the-complete-ai-writing-assistant-guide-that-actually-works)
- [CRAFT Literary: Show Don't Tell — What AI Can't Do](https://www.craftliterary.com/2025/03/26/show-dont-tell-what-ai-cant-do/)
- [Roll for Narrative: How to Write LitRPG Without Losing the Plot](https://rollfornarrative.parrydox.com/p/4thewriters-how-to-write-litrpg-without)
- [Royal Road Forums: The Art of the Cliffhanger](https://www.royalroad.com/forums/thread/131550)
- [Royal Road Forums: Overdoing the Mini Cliffhanger](https://www.royalroad.com/forums/thread/104367)
- [John Champaign: Strategies for Success on Royal Road](https://johnchampaign.com/2024/01/29/strategies-for-success-releasing-litrpg-stories-on-royal-road/)
- [Reddit/ResizeMyImg: Writing a Novel with AI in 2025](https://resizemyimg.com/blog/writing-a-novel-with-ai-in-2025-what-works-what-fails-and-real-reddit-writers-feedback-on-using-chatgpt-or-similar-models/)
- [Andrew Rowe: Writing Progression Fantasy](https://andrewkrowe.wordpress.com/2019/03/02/writing-progression-fantasy/)
- [SFF Chronicles: Why Writing LitRPG Is Harder Than People Think](https://www.sffchronicles.com/threads/590319/)
- [RecordCrash: How to Identify AI-Written Web Fiction](https://recordcrash.substack.com/p/how-to-identify-ai-written-web-fiction)
- [Write With AI Substack: 9 Claude Writing Tips](https://writewithai.substack.com/p/9-chatgpt-and-claude-writing-tips)

---

**Document Version**: 1.2
**Last Updated**: March 2026
**Status**: Complete synthesis for InkOS English prompt development (Appendix A: Reddit/community sources, Appendix B: Extended AI community + practitioner research)

This research document is intended to serve as the authoritative foundation for building InkOS's English prompt system. All sections are comprehensive enough to inform automated writing instruction, quality audit dimensions, and anti-AI detection protocols.
