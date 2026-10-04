/**
 * Character names, taglines and rules (Chinese). `{{placeholders}}` are filled
 * from each character's `ruleValues`, i.e. the live tuning constants.
 */
const characters = {
  vampire: {
    name: '吸血鬼',
    tagline: '咬住就不松口',
    rules: [
      '獠牙朝前撞到敌人时咬住对方，跟随移动 {{latchDuration}} 秒',
      '每 {{biteInterval}} 秒吸血一次：敌人 -{{biteDamage}}，自己 +{{biteDamage}}',
      '回血没有上限，血量可以超过 100',
      '被强力击退会被甩开',
    ],
  },
  conductor: {
    name: '列车长',
    tagline: '铁轨铺到哪，火车开到哪',
    rules: [
      '从撞墙点开始，沿自己的轨迹铺设铁轨',
      '再撞墙 {{trackBounces}} 次后铁轨完工，火车驶来，同时开始铺下一条',
      '车头 -{{engineDamage}}，车厢 -{{wagonDamage}}，每班车最多命中 {{maxHitsPerRun}} 次',
      '首班车 {{baseWagons}} 节车厢，之后每班多 {{wagonsPerRun}} 节，越来越难躲',
    ],
  },
  anchor: {
    name: '船锚',
    tagline: '铁链一甩，锚到就疼',
    rules: [
      '用铁链拖着一只倒刺船锚，平时像流星锤一样甩动',
      '敌人靠近时抛出船锚（冷却 {{castCooldown}} 秒），钩中后把敌人往回拽',
      '伤害取决于撞击速度：1 ~ {{maxDamage}} 点',
      '船锚会在墙壁上反弹',
    ],
  },
  fishhook: {
    name: '鱼钩',
    tagline: '愿者上钩',
    rules: [
      '朝敌人甩出鱼钩，甩钩时本体原地停下不动',
      '鱼钩像子弹一样飞，碰墙按入射角反弹；鱼线在每个碰墙点固定，留下一条折线轨迹',
      '鱼钩会一直弹，直到钩住敌人为止；鱼线只是轨迹，碰到不受伤',
      '钩住后沿整条鱼线把敌人拖回本体，每 {{reelTick}} 秒 -{{reelDamage}}',
      '拖到身边就把敌人甩开，本体恢复移动，{{recastDelay}} 秒后再甩下一钩',
    ],
  },
  toxicSpike: {
    name: '毒刺',
    tagline: '整个场地都是我的陷阱',
    rules: [
      '每次撞墙都会在撞击点插下一根毒刺',
      '敌人碰到毒刺 -{{spikeDamage}}，并叠加一层中毒',
      '每层中毒每秒 -1，持续 {{poisonTicks}} 秒，最多 {{maxPoisonStacks}} 层',
      '毒刺一直保留（最多 {{maxSpikes}} 根），越打越强',
    ],
  },
  cobweb: {
    name: '蜘蛛网',
    tagline: '每一根丝都连着我',
    rules: [
      '每次撞墙都会在墙上固定一根蛛丝，另一端连着自己',
      '蛛丝跟着本体扫过整个场地',
      '敌人每碰到一根蛛丝 -{{threadDamage}}，并被短暂减速',
      '蛛丝最多 {{maxThreads}} 根，越多越难躲',
    ],
  },
  shuriken: {
    name: '手里剑',
    tagline: '飞镖满天飞',
    rules: [
      '定时沿自己前进的方向连续掷出手里剑',
      '手里剑会在墙壁间无限反弹，命中敌人 -{{starDamage}} 后消失',
      '每轮投掷越来越多，最多一次 {{maxVolley}} 枚',
      '每轮之间间隔 {{volleyCooldown}} 秒',
    ],
  },
  grenade: {
    name: '手榴弹',
    tagline: '慢热的地毯式轰炸',
    rules: [
      '每 {{waveInterval}} 秒在身边召唤一圈手榴弹，随后抛向敌人附近引爆',
      '每颗爆炸对范围内敌人 -{{grenadeDamage}}（半径约 {{blastRadii}} 个球半径）',
      '每一波比上一波多一颗，最多 {{maxWave}} 颗',
      '爆炸不会伤到自己',
    ],
  },
  hammer: {
    name: '锤神',
    tagline: '一锤一个缴械',
    rules: [
      '一柄战锤绕着本体不停旋转',
      '锤头砸中敌人 -{{hammerDamage}}，同一目标每 {{hitCooldown}} 秒最多一次',
      '被砸中的敌人缴械 {{disarmDuration}} 秒，期间无法发动新攻击',
      '锤子穿墙而过，只有本体会撞墙',
    ],
  },
  spider: {
    name: '蜘蛛',
    tagline: '网住你，慢慢吃',
    rules: [
      '朝敌人吐出一张蛛网，网住后敌人原地定身 {{trapDuration}} 秒',
      '蜘蛛爬过去扒住猎物，每口 -{{biteDamage}}，咬速随时间越来越快；自己被定住时改用蛛丝把猎物拉过来',
      '命中后 {{hitCooldown}} 秒才能再吐网，落空则冷却更短',
      '被网住期间敌人被缴械，无法发动新的攻击（已经放出去的照样有效）',
    ],
  },
  drill: {
    name: '电钻',
    tagline: '钻头永远对准你',
    rules: [
      '钻头始终指向敌人',
      '钻尖扎进敌人后锁住对方，连钻 {{drillTicks}} 下，每下 -{{drillDamage}}',
      '钻完松开，双方各自按原来的方向继续移动',
      '每次钻击冷却 {{drillCooldown}} 秒',
    ],
  },
  chess: {
    name: '象棋',
    tagline: '按棋子的走法冲锋',
    rules: [
      '定时铺开棋盘，自己滑到中心格',
      '挑一枚最能扫到敌人的棋子：车走直线、象走斜线、马走日字',
      '沿走法来回冲刺 4 次，每次撞中 -{{chessDamage}} 并撞飞敌人',
      '冲刺期间无敌（蓝色光环），棋盘收起后冷却 {{modeCooldown}} 秒',
    ],
  },
  mathBall: {
    name: '术理球',
    tagline: '全靠算，也全靠运气',
    rules: [
      '每 {{rollInterval}} 秒滚动算出一个随机数字，然后扔向敌人',
      '砸中扣对应的血：大多是个位数，最大可达 {{maxNumber}}',
      '≥10 的概率约 {{chanceTwoDigitsPercent}}%，≥100 约 {{chanceThreeDigitsPercent}}%',
      '扔出的数字会追踪敌人，但转向有限，可以躲开',
    ],
  },
  electric: {
    name: '雷电',
    tagline: '碰一下就麻了',
    rules: [
      '本体撞到敌人时放电，敌人原地麻痹 {{stunDuration}} 秒',
      '麻痹期间每 0.5 秒 -{{shockDamage}}，共 {{shockTicks}} 次',
      '每次放电后 {{shockCooldown}} 秒才能再放',
      '麻痹的敌人仍然可以发动武器',
    ],
  },
  gojo: {
    name: '五条悟',
    tagline: '苍、赫、茈',
    rules: [
      '每次撞墙放出一颗会自己反弹的咒力球（三选一随机）',
      '苍（蓝）：留在场上，靠近敌人时用连线持续吸取，每次 -{{blueTickDamage}}',
      '赫（红）：撞到敌人 -{{redDamage}}',
      '茈（紫）：较少出现、飞得慢，撞到敌人 -{{purpleDamage}}',
    ],
  },
  trapper: {
    name: '陷阱师',
    tagline: '进了笼子就别想出来',
    rules: [
      '每 {{castInterval}} 秒扔出 {{trapsPerCast}} 个带刺的笼子，其中一个扔在敌人前进的路上',
      '敌人整个进入笼子后就被关住，只能在里面来回弹',
      '每撞一次笼壁 -{{bounceDamage}}，跑得越快扣得越多',
      '笼子持续 {{trapLifetime}} 秒后一起消失',
    ],
  },
  laserV1: {
    name: '激光 V1',
    tagline: '靠近就烧',
    rules: [
      '敌人进入射程时自动锁定，持续发射光束',
      '光束每 {{v1Tick}} 秒 -{{v1Damage}}',
      '射程约 {{rangeRadii}} 个球半径，离开射程光束就断',
      '没有冷却，也不会随时间变强',
    ],
  },
  laserV2: {
    name: '激光 V2',
    tagline: '走过的路都会发光',
    rules: [
      '两次撞墙之间飞过的路线，会凝固成一条永久的激光线',
      '敌人碰到一条激光线 -{{v2Damage}}（同一条线 1 秒内只算一次）',
      '激光线越积越多，最多 {{v2MaxLines}} 条，旧线会消失',
      '自己的激光线伤不到自己',
    ],
  },
  laserV3: {
    name: '激光 V3',
    tagline: '墙上全是炮台',
    rules: [
      '每次撞墙在撞击点装一座激光炮台',
      '每座炮台每 {{v3Period}} 秒朝对面墙射一道贯穿全场的光束',
      '被光束扫到 -{{v3Damage}}，开火前有淡红色预警线',
      '炮台会一直保留（最多 {{v3MaxTurrets}} 座）',
    ],
  },
  blackHole: {
    name: '黑洞',
    tagline: '掉进去就出不来',
    rules: [
      '大约每 {{spawnInterval}} 秒在场地随机位置打开一个小黑洞',
      '敌人中心进入黑洞后被引力困住，只能绕着中心打转',
      '被困期间每 {{holeTick}} 秒 -{{holeDamage}}，多个黑洞可叠加',
      '黑洞 {{holeLifetime}} 秒后坍缩，敌人才能逃脱',
    ],
  },
  orbit: {
    name: '轨道',
    tagline: '自带一个小太阳系',
    rules: [
      '每 {{spawnInterval}} 秒长出一颗小球，绕着本体公转',
      '由内到外填满 {{ringCount}} 圈轨道（每圈 1、3、5、7 颗，最多 {{maxOrbs}} 颗）',
      '每圈转速不同，越靠内转得越快',
      '小球撞到敌人 -{{orbDamage}} 并消失，之后会慢慢补回来',
    ],
  },
  tornado: {
    name: '飓风',
    tagline: '风会一直追着你',
    rules: [
      '每 {{spawnInterval}} 秒在身后留下一个龙卷风',
      '龙卷风会慢慢追向敌人，碰到就把敌人卷进风眼',
      '被卷住约 1.8 秒，期间 {{ticks}} 次 -{{tickDamage}}，之后龙卷风消散',
      '没卷到人的龙卷风会在场上游荡一段时间',
    ],
  },
  acid: {
    name: '强酸',
    tagline: '走过的地方寸草不生',
    rules: [
      '每 {{spitInterval}} 秒往身后吐一滩强酸',
      '敌人碰到酸液就被腐蚀：每 0.5 秒 -{{acidDamage}}，离开后还会再烧约 0.5 秒',
      '同时踩着好几滩会成倍叠加（最多 {{maxStack}} 倍）',
      '酸液一直留在场上（最多 {{maxPuddles}} 滩），自己不受影响',
    ],
  },
  zeus: {
    name: '宙斯',
    tagline: '天降神罚',
    rules: [
      '每 {{strikeInterval}} 秒在身边标出 {{bolts}} 个落雷点，标记会慢慢飘向敌人',
      '{{telegraphTime}} 秒后从自身劈出 {{bolts}} 道闪电打到标记上',
      '每道闪电或落点爆炸波及敌人 -{{boltDamage}}，三道可以同时命中',
      '本体没有其他攻击',
    ],
  },
  duplicator: {
    name: '复制者',
    tagline: '以多欺少',
    rules: [
      '本体没有武器',
      '每 {{waveInterval}} 秒在全场随机位置召唤 {{clonesPerWave}} 个持匕首的分身',
      '分身追着敌人扎，每下 -{{cloneDamage}}',
      '分身只有 {{cloneHp}} 点生命，每秒掉 1，几秒后自行消散',
    ],
  },
  glass: {
    name: '玻璃渣',
    tagline: '一路碎一路扎',
    rules: [
      '每次撞墙在墙边洒下 {{minShards}}~{{maxShards}} 片碎玻璃',
      '敌人每碾过一片 -{{shardDamage}}，碎片随之消失',
      '碎片会一直留在场上（最多 {{maxLiveShards}} 片）',
      '自己碾过碎片不受伤',
    ],
  },
  mimic: {
    name: '模仿者',
    tagline: '你会的我都会',
    rules: [
      '自己没有武器：随机抽取一名其他角色，变身 {{formTime}} 秒并使用它的全部能力',
      '变身期间造成的伤害 ×{{formDamageBonus}}',
      '变身结束后恢复原形 {{neutralTime}} 秒，再抽下一个',
      '被定身或缴械时无法变身；血量一直保留',
    ],
  },
  flamethrower: {
    name: '纵火犯',
    tagline: '离得越近烧得越旺',
    rules: [
      '双管喷火器始终对准敌人，进入射程就持续喷火',
      '贴近时每 {{flameCloseTick}} 秒 -{{fireDamage}}，火焰末端每 {{flameFarTick}} 秒 -{{fireDamage}}',
      '被烧到会着火：离开火焰后每 {{burnTick}} 秒 -{{burnDamage}}，最多烧 {{burnDuration}} 秒',
      '不减速也不击退，被缴械时停火',
    ],
  },
  quicksand: {
    name: '流沙',
    tagline: '越挣扎陷得越深',
    rules: [
      '每 {{throwInterval}} 秒往敌人前进的方向扔一团沙，落地变成流沙坑',
      '流沙坑持续 {{zoneDuration}} 秒，场上最多 {{maxZones}} 个',
      '陷进流沙的敌人速度降到 {{slowPercent}}%，而且无法攻击',
      '在流沙里每 {{sandTick}} 秒 -{{sandDamage}}，自己不受影响',
    ],
  },
  cable: {
    name: '电缆',
    tagline: '墙到墙，全通电',
    rules: [
      '每撞两次墙，就在两个撞墙点之间拉起一根电缆（最多 {{maxCables}} 根）',
      '电缆持续 {{cableLife}} 秒，自己碰到没事',
      '敌人碰到电缆会触电 {{shockDuration}} 秒：每 {{shockTick}} 秒 -{{shockDamage}}，再碰会续时间',
      '触电期间速度降到 {{shockSlowPercent}}%',
    ],
  },
  volcano: {
    name: '火山',
    tagline: '原地爆发，岩浆遍地',
    rules: [
      '每约 {{eruptInterval}} 秒停下 {{stopTime}} 秒原地喷发，{{boltCount}} 道岩浆裂缝延伸到场边',
      '岩浆持续约 {{lavaTime}} 秒，敌人碰到每 {{lavaTick}} 秒 -{{lavaDamage}}，速度降到 {{lavaSlowPercent}}%',
      '离开岩浆后继续灼烧 {{burnTicks}} 次，每 {{burnInterval}} 秒 -{{burnDamage}}',
      '被减速会推迟喷发，本体撞人没有伤害',
    ],
  },
  assassin: {
    name: '刺客',
    tagline: '越转越快的剑',
    rules: [
      '一把长剑从中心向外伸出，顺时针不停旋转',
      '剑刃扫中敌人 -{{swordDamage}}，同一目标每 {{swordCooldown}} 秒最多一次',
      '转速（初始 {{spinDegPerSec}}°/秒）和移动速度随时间不断增长，最高 {{maxGrowth}} 倍',
      '被缴械或定身时长剑停转，无法伤人',
    ],
  },
  frost: {
    name: '冰霜',
    tagline: '踩上冰路就别想走',
    rules: [
      '走过的地方留下一条冰晶路，持续 {{trailLifetime}} 秒',
      '敌人踏上冰路就会被冻住：逐渐停下并被缴械',
      '待在冰路上每 {{frostTick}} 秒 -{{frostDamage}}',
      '自己不受冰路影响，撞击没有伤害',
    ],
  },
  spear: {
    name: '长矛',
    tagline: '越冲越快，越刺越疼',
    rules: [
      '一杆长矛始终朝着前进方向，矛尖在前',
      '矛尖刺中敌人造成伤害并把它顶飞，同一目标每 {{spearCooldown}} 秒最多一次',
      '伤害随时间增长：{{baseDamage}} + {{damageGrowth}} × 战斗秒数',
      '移动速度随时间增长，最高 {{maxGrowth}} 倍',
    ],
  },
  necromancer: {
    name: '死灵巫师',
    tagline: '骷髅大军',
    rules: [
      '本体没有攻击，每 {{summonIntervalStart}} 秒在身边召唤一个骷髅弓箭手（最多 {{maxSkeletons}} 个）',
      '召唤间隔随战斗时间越来越短，最快 {{summonIntervalMin}} 秒一个',
      '骷髅只存在 {{skeletonLife}} 秒，一边乱飘一边每 {{arrowInterval}} 秒朝敌人射一箭',
      '每支箭命中 -{{arrowDamage}}',
    ],
  },
  boomerang: {
    name: '回旋镖',
    tagline: '去了还会回来',
    rules: [
      '一只回旋镖绕着本体旋转，碰到敌人也会造成伤害（被缴械时转着的不伤人）',
      '每隔 {{throwCooldown}} 秒朝敌人掷出，画一个来回的弧线飞回本体（约 {{flightTime}} 秒）',
      '命中敌人 -{{boomerangDamage}}，回旋镖直接穿过',
      '去程和回程都能打中，一次投掷可以命中两下',
    ],
  },
  trident: {
    name: '三叉戟',
    tagline: '一戟穿心',
    rules: [
      '三叉戟悬在身旁，每 {{throwInterval}} 秒对准敌人当前位置掷出一次',
      '直线飞行，最远 {{maxRange}}，命中敌人 -{{tridentDamage}}',
      '命中后插在敌人身上 {{stickTime}} 秒，再飞回主人身边',
      '只瞄准不追踪，敌人走位就能躲开',
    ],
  },
  disco: {
    name: '迪斯科',
    tagline: '全场一起蹦迪',
    rules: [
      '每 {{burstInterval}} 秒向四周射出 {{barCount}} 道彩虹光棒，命中 -{{barDamage}}',
      '被光棒或舞池打中会持续掉血：每 {{dotInterval}} 秒 -{{dotDamage}}，共 {{dotTicks}} 次（重复命中只刷新不叠加）',
      '每 {{floorInterval}} 秒全场变成 {{floorGrid}}×{{floorGrid}} 数字舞池，格子上随机写着 {{floorMin}}～{{floorMax}}',
      '敌人每踩进一个格子就扣格子上的数字，跨在几格之间会同时触发，自己不受影响',
    ],
  },
  frog: {
    name: '青蛙',
    tagline: '舌头一卷，一口吞下',
    rules: [
      '敌人进入 {{tongueRangeR}} 个身位内时吐出舌头（冷却 {{tongueCooldown}} 秒）',
      '舌头命中 -{{hitDamage}}，并把敌人往回拖，拖拽中每 {{pullTick}} 秒 -{{pullDamage}}',
      '拖到嘴边后整个吞下 {{swallowTime}} 秒，再朝随机方向吐出去',
      '本体碰撞没有伤害',
    ],
  },
  magnet: {
    name: '磁铁',
    tagline: '异极相吸，一碰就炸',
    rules: [
      '每 {{spawnInterval}} 秒在身边放下一根条形磁铁（场上最多 {{maxBars}} 根）',
      '磁铁会互相吸引，{{pairRangeR}} 个身位内的两根会滑到一起；落单的磁铁慢慢飘向敌人',
      '两根磁铁吸在一起 {{fuseTime}} 秒后爆炸',
      '爆炸中心最高 -{{maxDamage}}，离得越远伤害越低（每个身位少 {{falloff}}）',
    ],
  },
  cannon: {
    name: '大炮',
    tagline: '瞄准，开炮！',
    rules: [
      '炮管平时跟着前进方向转，开炮前一刻才转向敌人，预判它的走位瞄准',
      '每发炮弹直线飞行，命中 -{{shellDamage}}，撞墙即消失',
      '开炮间隔从 {{cooldownStart}} 秒起，{{cooldownRamp}} 秒内逐渐缩短到 {{cooldownEnd}} 秒',
      '炮管提前 {{aimTime}} 秒开始瞄准，躲开就打空',
    ],
  },
  clone: {
    name: '克隆',
    tagline: '到处都是我的影子',
    rules: [
      '每 {{dropInterval}} 秒在原地留下一个半透明分身（最多 {{maxGhosts}} 个）',
      '分身一动不动，一直留到被触发为止',
      '敌人碰到分身就会引爆它 -{{ghostDamage}}，并像撞到球一样被弹开',
      '本体没有其他攻击',
    ],
  },
  cutter: {
    name: '切割者',
    tagline: '一刀把场地切开',
    rules: [
      '两次撞墙之间飞过的路线变成一道切割线（最多同时 {{maxLines}} 道）',
      '切割线把场地分成两块，较小的那块变成危险区，持续 {{lineLife}} 秒',
      '敌人待在危险区里每 {{cutTick}} 秒 -{{cutDamage}}，叠在两块以上时加快到每 {{cutTickStacked}} 秒',
      '自己不受危险区影响',
    ],
  },
  blasters: {
    name: '蒙犽',
    tagline: '双枪齐射，火力压制',
    rules: [
      '两侧各挂一把枪，枪口带一点延迟跟着敌人转',
      '每轮连射 {{burstTime}} 秒，每把枪每 {{fireInterval}} 秒打一发',
      '每颗子弹命中 -{{bulletDamage}}，撞墙即消失',
      '打完一轮要换弹 {{reloadTime}} 秒，期间不能开火',
    ],
  },
  spike: {
    name: '铁刺',
    tagline: '小心，别扎到自己',
    rules: [
      '每次撞墙，{{spikeDelay}} 秒后会在撞击点长出一根永久钢刺',
      '敌人碰到钢刺 -{{spikeDamage}}，铁刺自己碰到也会被扎 -{{selfDamage}}',
      '同一根刺对同一个球每 {{spikeCooldown}} 秒最多扎一次',
      '钢刺不阻挡移动，最多保留 {{maxSpikes}} 根（满了拔掉最旧的）',
    ],
  },
  sonic: {
    name: '音波',
    tagline: '一圈一圈震碎你',
    rules: [
      '每 {{pulseInterval}} 秒在原地发出一次声波，一次 {{ringsPerPulse}} 圈',
      '声波环向外扩散，最远到 {{ringReach}} 个球半径',
      '每圈扫过敌人时命中一次，造成 {{ringMinDamage}}–{{ringMaxDamage}} 伤害',
      '离声源越近伤害越高，没有击退',
    ],
  },
  saw: {
    name: '铁锯',
    tagline: '两片圆锯，绕身飞旋',
    rules: [
      '两片圆锯在本体两侧对称公转，锯片自己也在高速旋转',
      '锯片切到敌人 -{{sawDamage}}，每片锯同一目标每 {{bladeCooldown}} 秒最多一次',
      '顺时针每秒转 {{orbitDeg}}°，锯片穿墙而过',
      '本体撞击没有伤害；缴械时锯片照转但切不动',
    ],
  },
  sawV2: {
    name: '铁锯 V2',
    tagline: '撞墙蓄力，一撞翻倍',
    rules: [
      '锯片收回体内，浑身尖刺高速自转',
      '本体撞到敌人 -{{bodyDamage}}，同一目标每 {{contactCooldown}} 秒最多一次',
      '撞墙后 {{chargeWindow}} 秒内处于蓄力状态，撞击伤害翻倍为 -{{chargedDamage}}',
      '撞墙时火花四溅，蓄力时身后拖出白色疾风',
    ],
  },
  alchemist: {
    name: '药剂师',
    tagline: '今天想尝哪一瓶？',
    rules: [
      '每 {{throwInterval}} 秒朝敌人随机扔出一瓶药剂，碎成一团药雾（持续 {{cloudLifetime}} 秒，最多 {{maxClouds}} 团）',
      '绿色毒雾：每 {{greenTick}} 秒 -{{greenDamage}}，并叠加一层中毒',
      '红色酸雾：每 {{redTick}} 秒 -{{redDamage}}',
      '蓝色冰雾：把敌人冻住，每 {{blueTick}} 秒 -{{blueDamage}}；自己不受药雾影响',
    ],
  },
  meteor: {
    name: '星陨',
    tagline: '天降流星雨',
    rules: [
      '每 {{castInterval}}±{{castJitter}} 秒召唤一次流星雨，{{launchDelay}} 秒后从场外连续飞来 {{meteorsPerVolley}} 颗陨石',
      '每颗陨石瞄准敌人发射那一刻的位置，直线飞行后落地爆炸',
      '爆炸波及敌人 -{{minDamage}}~{{maxDamage}}，陨石越大伤害越高',
      '爆炸半径约 {{blastRadii}} 个球半径，会把敌人震开',
    ],
  },
  bomber: {
    name: '爆破者',
    tagline: '滴答滴答，全场开花',
    rules: [
      '每 {{plantCooldown}} 秒在脚下放一颗定时炸弹（被定身、抓住或缴械时暂停计时）',
      '炸弹 {{fuseTime}} 秒后爆炸，场上最多同时 {{maxBombs}} 颗',
      '爆炸波及全场：离得越近伤害越高，最多 -{{maxDamage}}，最远也有 -{{minDamage}}',
      '爆炸会把敌人炸飞，但不会伤到自己',
    ],
  },
  snowman: {
    name: '雪人',
    tagline: '走到哪儿堆到哪儿',
    rules: [
      '每次撞墙或撞到敌人，都会在碰撞点堆出一个雪人（最多 {{maxSnowmen}} 个）',
      '雪人原地站 {{snowmanLife}} 秒后融化，不挡路',
      '每个雪人每 {{throwInterval}} 秒朝敌人扔一个雪球',
      '雪球命中 -{{snowballDamage}}，飞到墙边就碎掉',
    ],
  },
  virus: {
    name: '病毒',
    tagline: '碰一下就传染',
    rules: [
      '没有武器，只靠身体接触传染（被缴械也照样传染）',
      '碰到敌人就会感染它：每 {{tickInterval}} 秒 -{{tickDamage}}，共 {{infectionTicks}} 次（约 {{infectionDuration}} 秒）',
      '感染期间再碰到不会叠加，也不会刷新',
      '感染结束 {{reinfectCooldown}} 秒后才能再次传染',
    ],
  },
  splitter: {
    name: '裂变',
    tagline: '越打越多',
    rules: [
      '碰到敌人 -{{splitDamage}}，然后分裂成两块，生命值对半分',
      '分出的碎片在场上自己弹跳，碰到敌人同样 -{{splitDamage}} 并继续分裂（最多 {{maxPieces}} 块）',
      '碎片分裂 {{mergeDelay}} 秒后再相互碰到会重新合体，生命值相加',
      '所有碎片的生命值加起来归零才算输',
    ],
  },
  freezer: {
    name: '冰川',
    tagline: '寒气逼人',
    rules: [
      '持续散发寒气：不论距离，每 {{chillTick}} 秒让敌人 -{{chillDamage}}',
      '每 {{waveInterval}} 秒在场上随机升起 {{pillarsPerWave}} 根冰柱，持续 {{pillarActive}} 秒',
      '敌人碰到冰柱立刻 -{{pillarDamage}}，贴着冰柱每 {{pillarTick}} 秒再 -{{pillarDamage}}',
      '碰到冰柱时速度降到 {{pillarSlowPercent}}%；冰柱不挡路，对自己无效',
    ],
  },
  hive: {
    name: '蜂巢',
    tagline: '蜂拥而至',
    rules: [
      '每 {{batchInterval}} 秒从蜂巢口放出一群蜜蜂',
      '第一批 {{batchStart}} 只，之后每批多 1 只，最多 {{batchMax}} 只',
      '蜜蜂追着敌人蜇，每下 -{{stingDamage}}',
      '蜜蜂只活 {{beeLife}} 秒，场上最多 {{maxBees}} 只',
    ],
  },
  rocket: {
    name: '火箭',
    tagline: '瞄准，点火！',
    rules: [
      '平时像普通球一样弹跳，火箭头朝着前进方向',
      '每 {{dashCooldown}} 秒停下蓄力 {{chargeTime}} 秒，把火箭头对准敌人',
      '随后点火沿瞄准方向高速冲刺 {{dashTime}} 秒，撞墙即停',
      '火箭头撞中敌人 -{{ramDamage}} 并把对方撞飞',
    ],
  },
  archer: {
    name: '弓箭手',
    tagline: '箭雨越下越密',
    rules: [
      '弓始终瞄准敌人当前所在的位置，射出直飞的箭',
      '每支箭命中 -{{arrowDamage}}，飞到墙上就会折断',
      '开战约 {{firstShot}} 秒射出第一箭，起初每 {{baseInterval}} 秒一箭',
      '{{rampStart}} 秒后射速越来越快，最终每 {{minInterval}} 秒一箭，连成箭流',
    ],
  },
  knight: {
    name: '骑士',
    tagline: '攻守兼备',
    rules: [
      '剑与盾轮流切换：持剑 {{modeMin}}~{{modeMax}} 秒、举盾 {{shieldMin}}~{{shieldMax}} 秒，开局先拔剑',
      '持剑：长剑朝敌人方向左右各 {{swingAmplitudeDeg}}° 来回挥砍，每 {{swingPeriod}} 秒一个来回',
      '剑刃砍中敌人 -{{swordDamage}} 并把它击飞，同一目标每 {{swordCooldown}} 秒最多一次',
      '举盾：完全免疫伤害，{{fanArcDeg}}° 的盾扇朝向敌人，碰到就把它弹开',
    ],
  },
  snake: {
    name: '蟒蛇',
    tagline: '越长越难躲',
    rules: [
      '身后拖着 {{startSegments}} 节身体，每 {{growInterval}} 秒长出一节（最多 {{maxSegments}} 节）',
      '身体的每一节碰到敌人都会 -{{segmentDamage}}，好几节可以同时咬',
      '同一节每 {{segmentCooldown}} 秒最多咬一次',
      '身体不挡路，敌人能直接穿过；蛇头本身没有伤害',
    ],
  },
  apple: {
    name: '小苹果儿',
    tagline: '一天一个苹果，血条不用发愁',
    rules: [
      '每 {{throwInterval}} 秒往随机方向扔一个苹果，滚一段停在地上（最多 {{maxApples}} 个）',
      '敌人踩到地上的苹果 -{{appleDamage}}',
      '自己吃到苹果回 {{appleHeal}} 点血，可以超过 100',
      '还在飞的苹果不会伤人',
    ],
  },
  shotgun: {
    name: '霰弹枪',
    tagline: '越打越快的霰弹',
    rules: [
      '一把霰弹枪慢慢转向敌人（每秒最多 {{turnDegrees}}°），装填好就开火，不管有没有瞄准',
      '开局 {{firstShot}} 秒后第一枪，每枪射出 {{pellets}} 颗弹丸，每颗 -{{pelletDamage}}',
      '射击间隔从 {{intervalStart}} 秒起每枪缩短 {{intervalShrinkPercent}}%，最快 {{intervalMin}} 秒一枪',
      '弹丸碰到墙壁就消失，没有后坐力',
    ],
  },
  wdc: {
    name: 'WDC',
    tagline: '九宫格抽数字',
    rules: [
      '每 {{cycleInterval}} 秒在整个场地铺开一张 3×3 数字九宫格，持续 {{gridDuration}} 秒',
      '格子里大多是 {{smallMin}}–{{smallMax}} 的小数字，但总有 {{bigCells}} 格藏着 {{bigMin}}–{{bigMax}} 的大数字',
      '九宫格期间打击 {{strikes}} 次，每次选中两球连线中点所在的格子',
      '敌人受到该格数字的伤害，不管敌人站在哪里',
    ],
  },
  cactus: {
    name: '仙人掌',
    tagline: '一身是刺别碰我',
    rules: [
      '浑身是刺，撞到敌人 -{{contactDamage}}（每 {{contactCooldown}} 秒最多一次）',
      '扎中敌人时向四周喷出 {{seeds}} 颗种子（冷却 {{burstCooldown}} 秒），太久没扎中也会自己喷',
      '种子落地长成小仙人掌，碰到敌人 -{{cactusDamage}}（每棵每 {{cactusHitCooldown}} 秒一次）',
      '仙人掌存在 {{cactusLifetime}} 秒后整批消失，不会扎到自己',
    ],
  },
  boxer: {
    name: '拳皇',
    tagline: '五连刺拳接重拳',
    rules: [
      '敌人靠近时左右拳交替快速出拳，每 {{punchCooldown}} 秒一拳',
      '每记刺拳命中 -{{jabDamage}}，不击退',
      '每命中 {{comboHits}} 拳蓄力 {{chargeTime}} 秒，打出重拳 -{{haymakerDamage}} 并把敌人击飞',
      '没有碰撞伤害，也不会回血',
    ],
  },
  phoenix: {
    name: '凤凰',
    tagline: '浴火重生',
    rules: [
      '每 {{volleyInterval}} 秒振翅一次，向两侧甩出 {{feathers}} 根火羽，羽毛会拐弯飞向敌人',
      '每根火羽命中 -{{featherDamage}}，飞到墙上就熄灭',
      '第一次血量归零时浴火重生：恢复 {{rebirthHp}} 点血，无敌 {{rebirthInvuln}} 秒，并清除中毒、减速和缴械',
      '重生时炸开一圈烈焰，{{burstRadius}} 个身位内的敌人 -{{burstDamage}} 并被炸飞；每局只能重生一次',
      '重生后振翅更快：每 {{rebornVolleyInterval}} 秒甩出 {{rebornFeathers}} 根火羽',
    ],
  },
  turtle: {
    name: '乌龟',
    tagline: '缩头也是一种进攻',
    rules: [
      '敌人靠近时伸长脖子咬一口 -{{biteDamage}}，每 {{biteCooldown}} 秒最多一口',
      '累计受到 {{shellTrigger}} 点伤害就缩进壳里 {{shellTime}} 秒：无敌，速度 ×{{shellSpeed}}',
      '龟壳朝敌人弹射，每次撞墙都会重新对准敌人；撞到敌人 -{{shellDamage}} 并把它撞开，每 {{shellHitCooldown}} 秒最多一次',
      '钻出龟壳后 {{shellCooldown}} 秒内受到的伤害不计入下一次缩壳',
      '被缴械时咬不了人，龟壳也撞不疼',
    ],
  },
  mirror: {
    name: '镜子',
    tagline: '打我多重，就还你几分',
    rules: [
      '受到敌人攻击时，把 {{reflectPercent}}% 的伤害反射回去，零头会累积',
      '每 {{beamInterval}} 秒朝最近的墙射出一道光，经墙壁反射后命中敌人 -{{beamDamage}}',
      '瞄准时会显示光路，发射前一刻锁定，敌人走位可以躲开',
      '被缴械时不能射光，但照样反射；反射的伤害不会再被反射，加时扣血不反射',
    ],
  },
  thief: {
    name: '窃贼',
    tagline: '你的就是我的',
    rules: [
      '没有自己的武器；可以下手时会悄悄转向敌人（每秒最多 {{stalkTurnDeg}}°）',
      '撞到敌人就偷走它的能力：敌人 -{{stealDamage}} 并被缴械 {{disarmTime}} 秒；每 {{stealCooldown}} 秒最多偷一次',
      '偷来的能力能用 {{lootTime}} 秒，再偷到同一个会续时间',
      '偷窃贼会抢走它手上的赃物，偷模仿者拿到它当前的变身，对方空手时随机得到一个能力；敌人无敌时偷不到',
    ],
  },
  puffer: {
    name: '河豚',
    tagline: '别碰我，我会炸',
    rules: [
      '平时没有攻击；每 {{puffPeriod}} 秒猛吸一口气，瞬间鼓成 {{puffScale}} 倍大，浑身竖起尖刺',
      '鼓起时碰到敌人 -{{spikeDamage}} 并把它狠狠弹开，同一目标每 {{hitCooldown}} 秒最多一次',
      '鼓气保持 {{holdTime}} 秒，再用 {{deflateTime}} 秒慢慢泄气；鼓起时体重变成 {{puffMass}} 倍',
      '缴械时不能鼓气，尖刺也不伤人；被抓住或定身时不能鼓气',
    ],
  },
  snowball: {
    name: '雪球',
    tagline: '越滚越大',
    rules: [
      '开局只有 {{startSize}}% 大小，滚动时不断沾雪长大，全速滚约 {{growTime}} 秒长到最大 {{maxSize}}%',
      '撞到敌人 -{{minDamage}}~{{maxDamage}}，个头越大越疼，同一目标每 {{ramCooldown}} 秒最多一次',
      '每受到 1 点伤害就被打掉一块雪，缩小 {{shrinkPerDamage}}%（最小缩回开局大小）',
      '被抓住或定身时滚不动，不会长大；缴械时撞人没有伤害',
    ],
  },
  gravity: {
    name: '重力',
    tagline: '整个场地都在倾斜',
    rules: [
      '重力只把敌人拉向一面墙，自己不受影响',
      '每 {{tiltInterval}} 秒场地倾斜一次，换一面墙当「地面」，提前 {{warnTime}} 秒预警',
      '敌人重重砸到地面时受伤，摔得越狠越痛，最多 -{{maxDamage}}',
      '轻轻落地不受伤；被缴械时场地不再倾斜',
    ],
  },
  portal: {
    name: '传送门',
    tagline: '从你身后的墙里出来',
    rules: [
      '每 {{portalInterval}} 秒在墙上打开一对传送门（间隔逐渐缩短到 {{minInterval}} 秒），最多持续 {{portalLife}} 秒',
      '蓝门开在自己要撞的墙上，橙门开在离敌人最近的墙上',
      '任何球碰到传送门（敌人也一样）都会从另一扇门出来，速度不变；被定身或抓住的球不会被传送',
      '本体穿过传送门后朝敌人冲刺 {{dashTime}} 秒，期间无敌并能穿过敌人，命中 -{{dashDamage}}',
      '本体穿过后这对门随即关闭；被缴械时不开门也不冲刺',
    ],
  },
  sumo: {
    name: '相扑',
    tagline: '墙才是最硬的拳头',
    rules: [
      '体重是普通球的好几倍，撞上去几乎推不动它',
      '身体碰到敌人就把它猛推出去，每 {{shoveCooldown}} 秒一次',
      '敌人靠近时跺脚震地，-{{stompDamage}} 并把敌人震开，每 {{stompCooldown}} 秒一次',
      '被推开后 {{slamWindow}} 秒内撞到墙上，墙壁造成 -{{slamMinDamage}}~{{slamMaxDamage}}，撞得越快越痛',
      '被缴械时不能推人也不能跺脚',
    ],
  },
  timeStop: {
    name: '时停',
    tagline: '时间，停止吧！',
    rules: [
      '发动时停：敌人被定身并缴械，整个世界失去颜色；时停结束 {{stopCooldown}} 秒后才能再次发动',
      '第一次时停 {{stopStart}} 秒，之后每次延长 {{stopGrowth}} 秒，最长 {{stopMax}} 秒',
      '时停期间自己照常移动，每 {{knifeInterval}} 秒往敌人周围掷一把飞刀，飞刀悬停在半空',
      '时间恢复的瞬间所有飞刀一齐射向敌人，每把 -{{knifeDamage}}；没射中的飞到墙边消失',
      '两次时停之间，每 {{tossInterval}} 秒朝敌人扔一把飞刀（同样 -{{knifeDamage}}）',
    ],
  },
  echo: {
    name: '残影',
    tagline: '过去的我也在战斗',
    rules: [
      '本体不断记录自己走过的路线，撞人没有伤害',
      '每 {{echoInterval}} 秒召唤一个残影（最多同时 {{maxEchoes}} 个），存在 {{echoLife}} 秒',
      '残影原样重演本体 {{lagMin}}~{{lagMax}} 秒前的走位，挑最可能撞上敌人的那一段',
      '残影不挡路，碰到敌人 -{{echoDamage}}，同一残影每 {{hitCooldown}} 秒最多一次',
      '被缴械时不召唤新残影，已有的照常伤人',
    ],
  },
  voodoo: {
    name: '巫毒娃娃',
    tagline: '扎小人，远程伤害',
    rules: [
      '把一个巫毒娃娃扔到场上，尽量远离敌人',
      '每 {{stabInterval}} 秒往娃娃身上扎一针，敌人不管在哪都受伤：第一针 -{{stabDamage}}',
      '同一个娃娃每多扎一针伤害 +{{stabGrowth}}，最多 -{{stabMax}}',
      '敌人碰到娃娃就会把它撕碎，{{dollRespawn}} 秒后再扔出一个新娃娃',
    ],
  },
} as const

export default characters
