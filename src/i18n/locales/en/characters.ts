import type zh from '../zh/characters'
import type { LocaleShape } from '../../types'

/**
 * Character names, taglines and rules (English). `{{placeholders}}` are filled
 * from each character's `ruleValues`, i.e. the live tuning constants.
 */
const characters = {
  vampire: {
    name: 'Vampire',
    tagline: 'Bites and never lets go',
    rules: [
      'Fangs-first contact latches onto the enemy, riding along for {{latchDuration}}s',
      'Drains every {{biteInterval}}s: enemy -{{biteDamage}}, self +{{biteDamage}}',
      'No healing cap: HP can go above 100',
      'A strong knockback shakes it loose',
    ],
  },
  conductor: {
    name: 'Conductor',
    tagline: 'Lay the track, the train will come',
    rules: [
      'Lays railway track along its own path, starting from a wall bounce',
      'After {{trackBounces}} more wall bounces the track is done: a train rolls in and the next track begins',
      'Engine -{{engineDamage}}, wagon -{{wagonDamage}}; at most {{maxHitsPerRun}} hits per train',
      'First train has {{baseWagons}} wagons, each later one adds {{wagonsPerRun}} more: harder and harder to dodge',
    ],
  },
  anchor: {
    name: 'Anchor',
    tagline: 'Swing the chain, sink the hit',
    rules: [
      'Drags a barbed anchor on a chain, swinging it like a flail',
      'Casts the anchor when the enemy gets close ({{castCooldown}}s cooldown) and reels it back on a hit',
      'Damage scales with impact speed: 1–{{maxDamage}}',
      'The anchor bounces off walls',
    ],
  },
  fishhook: {
    name: 'Fishhook',
    tagline: 'Every bounce leaves a line',
    rules: [
      'Plants itself and casts a hook at the enemy; it stays put while the line is out',
      'The hook flies like a bullet and bounces off walls at the mirror angle; the line is pinned at every bounce, leaving its path on the field',
      'The hook keeps bouncing until it snags the enemy; the line itself is harmless',
      'A snagged enemy is reeled back along the whole line to the angler, -{{reelDamage}} every {{reelTick}}s',
      'Once it arrives it is flung away, the angler moves again and casts the next hook {{recastDelay}}s later',
    ],
  },
  toxicSpike: {
    name: 'Toxic Spike',
    tagline: 'The whole arena is my trap',
    rules: [
      'Every wall bounce plants a toxic spike at the impact point',
      'Touching a spike deals -{{spikeDamage}} to the enemy and adds a poison stack',
      'Each poison stack deals -1 per second for {{poisonTicks}}s, up to {{maxPoisonStacks}} stacks',
      'Spikes stay for good (up to {{maxSpikes}}), so it grows stronger over time',
    ],
  },
  cobweb: {
    name: 'Cobweb',
    tagline: 'Every thread leads back to me',
    rules: [
      'Every wall bounce pins a silk thread to the wall, tethered to the ball itself',
      'The threads sweep across the arena as the ball moves',
      'Each thread the enemy touches deals -{{threadDamage}} and briefly slows it',
      'Up to {{maxThreads}} threads; the more there are, the harder to dodge',
    ],
  },
  shuriken: {
    name: 'Shuriken',
    tagline: 'Throwing stars everywhere',
    rules: [
      'Periodically throws a stream of shuriken in its direction of travel',
      'Shuriken bounce between walls forever and vanish after hitting the enemy for -{{starDamage}}',
      'Each volley throws more, up to {{maxVolley}} at once',
      '{{volleyCooldown}}s between volleys',
    ],
  },
  grenade: {
    name: 'Grenade',
    tagline: 'Slow-burn carpet bombing',
    rules: [
      'Every {{waveInterval}}s summons a ring of grenades around itself, then lobs them near the enemy to explode',
      'Each blast deals -{{grenadeDamage}} to the enemy in range (radius about {{blastRadii}} ball radii)',
      'Each wave has one more grenade than the last, up to {{maxWave}}',
      'Explosions never hurt itself',
    ],
  },
  hammer: {
    name: 'Hammer',
    tagline: 'Every swing disarms',
    rules: [
      'A war hammer spins around the ball nonstop',
      'Hammer head hits for -{{hammerDamage}}; at most once per {{hitCooldown}}s per target',
      "Struck enemies are disarmed for {{disarmDuration}}s and can't start new attacks",
      'The hammer passes through walls; only the ball itself bounces',
    ],
  },
  spider: {
    name: 'Spider',
    tagline: 'Wrap you up, eat you slow',
    rules: [
      'Spits a web at the enemy; a caught enemy is rooted in place for {{trapDuration}}s',
      'The spider crawls over and clings to its prey: -{{biteDamage}} per bite, biting faster over time; if it is stuck itself, it reels the prey in on its silk',
      "After a hit it can't spit again for {{hitCooldown}}s; a miss has a shorter cooldown",
      "Webbed enemies are disarmed and can't start new attacks (ones already launched still work)",
    ],
  },
  drill: {
    name: 'Drill',
    tagline: 'The bit always points at you',
    rules: [
      'The drill bit always points at the enemy',
      'When the tip pierces the enemy it locks on and drills {{drillTicks}} times, -{{drillDamage}} each',
      'Then it lets go and both keep moving in their original directions',
      '{{drillCooldown}}s cooldown between drill attacks',
    ],
  },
  chess: {
    name: 'Chess',
    tagline: 'Charges by the rules of chess',
    rules: [
      'Periodically unfolds a chessboard and slides to the center square',
      'Picks the piece most likely to hit: rook moves straight, bishop diagonally, knight in an L',
      'Dashes back and forth along that move 4 times; each hit deals -{{chessDamage}} and knocks the enemy away',
      'Invincible while dashing (blue aura); {{modeCooldown}}s cooldown after the board folds away',
    ],
  },
  mathBall: {
    name: 'Math Ball',
    tagline: 'Pure math. Pure luck.',
    rules: [
      'Every {{rollInterval}}s rolls a random number, then throws it at the enemy',
      'A hit deals that much damage: usually a single digit, up to {{maxNumber}}',
      'About {{chanceTwoDigitsPercent}}% chance of ≥10, about {{chanceThreeDigitsPercent}}% of ≥100',
      'Thrown numbers home in on the enemy but turn slowly, so they can be dodged',
    ],
  },
  electric: {
    name: 'Electric',
    tagline: 'One touch and you freeze up',
    rules: [
      'Body contact with the enemy discharges, paralyzing it in place for {{stunDuration}}s',
      'While paralyzed: -{{shockDamage}} every 0.5s, {{shockTicks}} times',
      '{{shockCooldown}}s before it can discharge again',
      'Paralyzed enemies can still use their weapons',
    ],
  },
  gojo: {
    name: 'Gojo',
    tagline: 'Blue, Red, Hollow Purple',
    rules: [
      'Every wall bounce releases a bouncing cursed energy orb (one of three, at random)',
      'Blue: stays on the field and tethers to a nearby enemy, draining -{{blueTickDamage}} per tick',
      'Red: hits the enemy for -{{redDamage}}',
      'Hollow Purple: rarer and slower, hits the enemy for -{{purpleDamage}}',
    ],
  },
  trapper: {
    name: 'Trapper',
    tagline: 'Once caged, never free',
    rules: [
      "Every {{castInterval}}s throws {{trapsPerCast}} spiked cages, one of them into the enemy's path",
      'An enemy fully inside a cage is trapped and can only bounce around within it',
      'Each hit on the cage wall deals -{{bounceDamage}}; the faster it moves, the more HP it loses',
      'All cages vanish together after {{trapLifetime}}s',
    ],
  },
  laserV1: {
    name: 'Laser V1',
    tagline: 'Get close, get burned',
    rules: [
      'Auto-locks onto the enemy in range and fires a continuous beam',
      'The beam deals -{{v1Damage}} every {{v1Tick}}s',
      'Range is about {{rangeRadii}} ball radii; the beam breaks once the enemy leaves it',
      'No cooldown, and it never ramps up',
    ],
  },
  laserV2: {
    name: 'Laser V2',
    tagline: 'Every path it takes lights up',
    rules: [
      'The path flown between two wall bounces solidifies into a permanent laser line',
      'Touching a laser line deals -{{v2Damage}} to the enemy (once per second per line)',
      'Lines keep piling up, up to {{v2MaxLines}}; the oldest ones disappear',
      "Its own laser lines can't hurt it",
    ],
  },
  laserV3: {
    name: 'Laser V3',
    tagline: 'Turrets on every wall',
    rules: [
      'Every wall bounce mounts a laser turret at the impact point',
      'Every {{v3Period}}s each turret fires a beam across the whole arena at the opposite wall',
      'A beam hit deals -{{v3Damage}}; a faint red warning line shows before it fires',
      'Turrets stay for good (up to {{v3MaxTurrets}})',
    ],
  },
  blackHole: {
    name: 'Black Hole',
    tagline: 'What falls in stays in',
    rules: [
      'Roughly every {{spawnInterval}}s opens a small black hole at a random spot',
      "Once the enemy's center enters a hole, gravity traps it, circling the center",
      'While trapped: -{{holeDamage}} every {{holeTick}}s; multiple holes stack',
      'Only when the hole collapses after {{holeLifetime}}s can the enemy escape',
    ],
  },
  orbit: {
    name: 'Orbit',
    tagline: 'Comes with its own solar system',
    rules: [
      'Every {{spawnInterval}}s grows a small orb that orbits the ball',
      'Fills {{ringCount}} rings from the inside out (1, 3, 5, 7 orbs per ring, up to {{maxOrbs}})',
      'Each ring spins at its own speed; inner rings spin faster',
      'An orb that hits the enemy deals -{{orbDamage}} and vanishes, slowly regrowing later',
    ],
  },
  tornado: {
    name: 'Tornado',
    tagline: 'The wind keeps chasing you',
    rules: [
      'Every {{spawnInterval}}s leaves a tornado behind it',
      'Tornadoes slowly chase the enemy and suck it into the eye on contact',
      'Caught for about 1.8s, taking -{{tickDamage}} {{ticks}} times, then the tornado dissipates',
      'Tornadoes that catch no one wander the arena for a while',
    ],
  },
  acid: {
    name: 'Acid',
    tagline: 'Nothing grows where it has been',
    rules: [
      'Every {{spitInterval}}s spits a pool of acid behind it',
      'Acid corrodes the enemy on contact: -{{acidDamage}} every 0.5s, still burning about 0.5s after leaving',
      'Standing in several pools multiplies the damage (up to {{maxStack}}×)',
      'Acid stays on the field (up to {{maxPuddles}} pools) and never affects itself',
    ],
  },
  zeus: {
    name: 'Zeus',
    tagline: 'Wrath from the heavens',
    rules: [
      'Every {{strikeInterval}}s marks {{bolts}} strike points nearby; the marks slowly drift toward the enemy',
      'After {{telegraphTime}}s, {{bolts}} lightning bolts arc from the ball onto the marks',
      'Each bolt or impact blast deals -{{boltDamage}} to the enemy; all three can hit at once',
      'The ball itself has no other attack',
    ],
  },
  duplicator: {
    name: 'Duplicator',
    tagline: 'Strength in numbers',
    rules: [
      'The ball itself has no weapon',
      'Every {{waveInterval}}s summons {{clonesPerWave}} dagger-wielding clones at random spots across the arena',
      'Clones chase and stab the enemy, -{{cloneDamage}} per stab',
      'Clones have only {{cloneHp}} HP, lose 1 per second, and fade away after a few seconds',
    ],
  },
  glass: {
    name: 'Glass',
    tagline: 'Leaves broken glass everywhere',
    rules: [
      'Every wall bounce scatters {{minShards}}–{{maxShards}} glass shards along the wall',
      'Each shard the enemy rolls over deals -{{shardDamage}} and breaks',
      'Shards stay on the field (up to {{maxLiveShards}})',
      'Rolling over its own shards does no harm',
    ],
  },
  mimic: {
    name: 'Mimic',
    tagline: 'Anything you can do, I can do',
    rules: [
      'No weapon of its own: becomes a random other character for {{formTime}}s, with all its abilities',
      'Damage dealt while transformed ×{{formDamageBonus}}',
      'After each form it reverts for {{neutralTime}}s, then draws the next',
      "Can't transform while rooted or disarmed; HP always carries over",
    ],
  },
  flamethrower: {
    name: 'Flamethrower',
    tagline: 'The closer you get, the hotter it burns',
    rules: [
      "Twin-barrel flamethrower always aims at the enemy and sprays fire whenever it's in range",
      "Up close -{{fireDamage}} every {{flameCloseTick}}s; at the flame's tip -{{fireDamage}} every {{flameFarTick}}s",
      'Burned enemies catch fire: after leaving the flames, -{{burnDamage}} every {{burnTick}}s for up to {{burnDuration}}s',
      'No slow and no knockback; stops firing while disarmed',
    ],
  },
  quicksand: {
    name: 'Quicksand',
    tagline: 'Struggle and you sink deeper',
    rules: [
      'Every {{throwInterval}}s throws a clump of sand ahead of the enemy that lands as a quicksand pit',
      'Pits last {{zoneDuration}}s, up to {{maxZones}} on the field',
      "An enemy caught in quicksand drops to {{slowPercent}}% speed and can't attack",
      'Inside quicksand: -{{sandDamage}} every {{sandTick}}s; it never affects itself',
    ],
  },
  cable: {
    name: 'Cable',
    tagline: 'Wall to wall, fully live',
    rules: [
      'Every two wall bounces strings a cable between the two impact points (up to {{maxCables}})',
      'Cables last {{cableLife}}s and are harmless to itself',
      'Touching a cable shocks the enemy for {{shockDuration}}s: -{{shockDamage}} every {{shockTick}}s; touching again extends it',
      'Shocked enemies drop to {{shockSlowPercent}}% speed',
    ],
  },
  volcano: {
    name: 'Volcano',
    tagline: 'Erupts in place, lava everywhere',
    rules: [
      'About every {{eruptInterval}}s it stops for {{stopTime}}s to erupt; {{boltCount}} lava fissures run to the edges',
      'Lava lasts about {{lavaTime}}s; touching it deals -{{lavaDamage}} every {{lavaTick}}s and slows the enemy to {{lavaSlowPercent}}%',
      'After leaving the lava the enemy keeps burning {{burnTicks}} times, -{{burnDamage}} every {{burnInterval}}s',
      'Being slowed delays the eruption; body contact deals no damage',
    ],
  },
  assassin: {
    name: 'Assassin',
    tagline: 'A blade that spins ever faster',
    rules: [
      'A long sword extends from the center, spinning clockwise nonstop',
      'Blade hits for -{{swordDamage}}; at most once per {{swordCooldown}}s per target',
      'Spin speed (starting at {{spinDegPerSec}}°/s) and movement speed keep growing, up to {{maxGrowth}}×',
      'While disarmed or rooted the sword stops spinning and deals no damage',
    ],
  },
  frost: {
    name: 'Frost',
    tagline: "Step on the ice and you're stuck",
    rules: [
      'Leaves a trail of ice crystals that lasts {{trailLifetime}}s',
      'An enemy on the ice trail freezes: it gradually stops and is disarmed',
      'While on the ice: -{{frostDamage}} every {{frostTick}}s',
      'Unaffected by its own ice; collisions deal no damage',
    ],
  },
  spear: {
    name: 'Spear',
    tagline: 'Charges faster, stabs harder',
    rules: [
      'A spear always points in the direction of travel, tip first',
      'The tip damages the enemy and knocks it flying; at most once per {{spearCooldown}}s per target',
      'Damage grows over time: {{baseDamage}} + {{damageGrowth}} × seconds elapsed',
      'Movement speed grows over time, up to {{maxGrowth}}×',
    ],
  },
  necromancer: {
    name: 'Necromancer',
    tagline: 'Rise, skeleton army',
    rules: [
      'The ball itself has no attack; every {{summonIntervalStart}}s it summons a skeleton archer nearby (up to {{maxSkeletons}})',
      'The summon interval shrinks as the battle goes on, down to one every {{summonIntervalMin}}s',
      'Skeletons last only {{skeletonLife}}s, drifting around and shooting an arrow at the enemy every {{arrowInterval}}s',
      'Each arrow hits for -{{arrowDamage}}',
    ],
  },
  boomerang: {
    name: 'Boomerang',
    tagline: 'What goes around comes around',
    rules: [
      'A boomerang circles the ball and hurts the enemy on contact too (not while disarmed)',
      'Every {{throwCooldown}}s it is thrown at the enemy, arcing out and back to the ball (about {{flightTime}}s)',
      'Hits the enemy for -{{boomerangDamage}} and passes straight through',
      'Can hit on the way out and on the way back: two hits per throw',
    ],
  },
  trident: {
    name: 'Trident',
    tagline: 'Straight through the heart',
    rules: [
      "Hovers beside the ball; every {{throwInterval}}s it is hurled at the enemy's current position",
      'Flies in a straight line (max range {{maxRange}}); a hit deals -{{tridentDamage}}',
      'On a hit it sticks in the enemy for {{stickTime}}s, then flies back to its owner',
      'Aimed, not homing: the enemy can dodge by moving',
    ],
  },
  disco: {
    name: 'Disco Ball',
    tagline: 'Everybody on the dance floor',
    rules: [
      'Every {{burstInterval}}s fires {{barCount}} rainbow light bars in all directions, -{{barDamage}} per hit',
      'Hits from light bars or the dance floor deal damage over time: -{{dotDamage}} every {{dotInterval}}s, {{dotTicks}} times (repeat hits refresh, not stack)',
      'Every {{floorInterval}}s the arena becomes a {{floorGrid}}×{{floorGrid}} number dance floor, each tile showing a random {{floorMin}}–{{floorMax}}',
      'Each tile the enemy steps into deals its number; straddling tiles triggers them all; it never affects itself',
    ],
  },
  frog: {
    name: 'Frog',
    tagline: 'One flick of the tongue, one gulp',
    rules: [
      'Flicks its tongue when the enemy is within {{tongueRangeR}} ball widths ({{tongueCooldown}}s cooldown)',
      'A tongue hit deals -{{hitDamage}} and drags the enemy back, -{{pullDamage}} every {{pullTick}}s while pulling',
      'Once at its mouth, the enemy is swallowed whole for {{swallowTime}}s, then spat out in a random direction',
      'Body collisions deal no damage',
    ],
  },
  magnet: {
    name: 'Magnet',
    tagline: 'Opposites attract, then explode',
    rules: [
      'Every {{spawnInterval}}s drops a bar magnet nearby (up to {{maxBars}} on the field)',
      'Magnets attract: two within {{pairRangeR}} ball widths slide together; lone magnets slowly drift toward the enemy',
      'Two joined magnets explode after {{fuseTime}}s',
      'Up to -{{maxDamage}} at the blast center, less with distance ({{falloff}} less per ball width)',
    ],
  },
  cannon: {
    name: 'Cannon',
    tagline: 'Ready, aim, fire!',
    rules: [
      'The barrel follows its direction of travel, turning to the enemy just before firing and leading its movement',
      'Each shell flies straight, hits for -{{shellDamage}}, and vanishes on hitting a wall',
      'Fire interval starts at {{cooldownStart}}s and shrinks to {{cooldownEnd}}s over {{cooldownRamp}}s',
      'The barrel starts aiming {{aimTime}}s early; dodge it and the shot misses',
    ],
  },
  clone: {
    name: 'Clone',
    tagline: 'My shadows are everywhere',
    rules: [
      'Every {{dropInterval}}s leaves a translucent clone where it stands (up to {{maxGhosts}})',
      'Clones never move and stay until triggered',
      'An enemy touching a clone detonates it for -{{ghostDamage}} and bounces off as if hitting a ball',
      'The ball itself has no other attack',
    ],
  },
  cutter: {
    name: 'Cutter',
    tagline: 'Slices the arena in two',
    rules: [
      'The path flown between two wall bounces becomes a cut line (up to {{maxLines}} at once)',
      'Each cut splits the arena in two; the smaller part becomes a danger zone for {{lineLife}}s',
      'Enemy in a danger zone: -{{cutDamage}} every {{cutTick}}s, sped up to every {{cutTickStacked}}s where two or more overlap',
      'Unaffected by its own danger zones',
    ],
  },
  blasters: {
    name: 'Blasters',
    tagline: 'Twin guns, suppressive fire',
    rules: [
      'A gun hangs on each side, tracking the enemy with a slight delay',
      'Each burst lasts {{burstTime}}s, with each gun firing every {{fireInterval}}s',
      'Each bullet hits for -{{bulletDamage}} and vanishes on hitting a wall',
      "After each burst it reloads for {{reloadTime}}s and can't fire",
    ],
  },
  spike: {
    name: 'Spike',
    tagline: "Careful, don't prick yourself",
    rules: [
      '{{spikeDelay}}s after each wall bounce, a permanent steel spike grows at the impact point',
      'Touching a spike deals -{{spikeDamage}} to the enemy; Spike itself takes -{{selfDamage}} on contact too',
      'Each spike pricks the same ball at most once per {{spikeCooldown}}s',
      "Spikes don't block movement; up to {{maxSpikes}} are kept (the oldest is removed when full)",
    ],
  },
  sonic: {
    name: 'Sonic',
    tagline: 'Shakes you apart, ring by ring',
    rules: [
      'Every {{pulseInterval}}s emits a sound pulse of {{ringsPerPulse}} rings where it stands',
      'Rings spread outward up to {{ringReach}} ball radii',
      'Each ring hits the enemy once as it sweeps past, dealing {{ringMinDamage}}–{{ringMaxDamage}} damage',
      'Closer to the source means more damage; no knockback',
    ],
  },
  saw: {
    name: 'Saw',
    tagline: 'Twin blades whirling around',
    rules: [
      'Two circular saws orbit symmetrically on either side, each spinning at high speed',
      'A blade hits for -{{sawDamage}}; each blade hits the same target at most once per {{bladeCooldown}}s',
      'Orbits clockwise at {{orbitDeg}}°/s; the blades pass through walls',
      "Body contact deals no damage; while disarmed the blades keep spinning but can't cut",
    ],
  },
  sawV2: {
    name: 'Saw V2',
    tagline: 'Bounce to charge, hit for double',
    rules: [
      'Blades retracted, its spiked body spins at high speed',
      'Body contact deals -{{bodyDamage}}; at most once per {{contactCooldown}}s per target',
      'For {{chargeWindow}}s after a wall bounce it is charged, doubling contact damage to -{{chargedDamage}}',
      'Sparks fly on wall bounces; a white gust trails behind it while charged',
    ],
  },
  alchemist: {
    name: 'Alchemist',
    tagline: 'Which potion will it be today?',
    rules: [
      'Every {{throwInterval}}s throws a random potion at the enemy that shatters into a cloud (lasts {{cloudLifetime}}s, up to {{maxClouds}})',
      'Green poison cloud: -{{greenDamage}} every {{greenTick}}s and adds a poison stack',
      'Red acid cloud: -{{redDamage}} every {{redTick}}s',
      'Blue frost cloud: freezes the enemy, -{{blueDamage}} every {{blueTick}}s; clouds never affect itself',
    ],
  },
  meteor: {
    name: 'Meteor',
    tagline: 'Meteor shower incoming',
    rules: [
      'Every {{castInterval}}±{{castJitter}}s calls a meteor shower; {{launchDelay}}s later {{meteorsPerVolley}} meteors fly in from off-screen',
      'Each meteor aims where the enemy was at launch, flies straight, and explodes on landing',
      'Blasts deal -{{minDamage}}–{{maxDamage}} to the enemy; bigger meteors hit harder',
      'Blast radius is about {{blastRadii}} ball radii and knocks the enemy back',
    ],
  },
  bomber: {
    name: 'Bomber',
    tagline: 'Tick, tock, boom',
    rules: [
      'Every {{plantCooldown}}s plants a time bomb underfoot (the timer pauses while rooted, grabbed or disarmed)',
      'Bombs explode after {{fuseTime}}s, up to {{maxBombs}} on the field at once',
      'Blasts reach the whole arena: the closer, the more damage, up to -{{maxDamage}} and at least -{{minDamage}}',
      'Blasts send the enemy flying but never hurt itself',
    ],
  },
  snowman: {
    name: 'Snowman',
    tagline: 'Builds snowmen wherever it goes',
    rules: [
      'Every wall bounce or enemy hit builds a snowman at the impact point (up to {{maxSnowmen}})',
      "Snowmen stand for {{snowmanLife}}s, then melt; they don't block movement",
      'Each snowman throws a snowball at the enemy every {{throwInterval}}s',
      'Snowballs hit for -{{snowballDamage}} and shatter on reaching a wall',
    ],
  },
  virus: {
    name: 'Virus',
    tagline: 'One touch and it spreads',
    rules: [
      'No weapon; infects by body contact alone (works even while disarmed)',
      'Touching the enemy infects it: -{{tickDamage}} every {{tickInterval}}s, {{infectionTicks}} times (about {{infectionDuration}}s)',
      'Touching again during an infection neither stacks nor refreshes it',
      'Can infect again only {{reinfectCooldown}}s after an infection ends',
    ],
  },
  splitter: {
    name: 'Splitter',
    tagline: 'Multiplies as it fights',
    rules: [
      'Touching the enemy deals -{{splitDamage}}, then it splits in two, halving its HP',
      'Fragments bounce on their own; each touch deals -{{splitDamage}} and splits again (up to {{maxPieces}} pieces)',
      'Fragments that touch each other {{mergeDelay}}s after splitting merge back, adding their HP',
      'It loses only when the combined HP of all fragments hits zero',
    ],
  },
  freezer: {
    name: 'Freezer',
    tagline: 'A bone-chilling presence',
    rules: [
      'Constantly radiates cold: -{{chillDamage}} to the enemy every {{chillTick}}s, at any distance',
      'Every {{waveInterval}}s raises {{pillarsPerWave}} ice pillars at random spots, lasting {{pillarActive}}s',
      'Touching a pillar deals -{{pillarDamage}} instantly, then -{{pillarDamage}} every {{pillarTick}}s while in contact',
      "Touching a pillar slows the enemy to {{pillarSlowPercent}}%; pillars don't block movement or affect itself",
    ],
  },
  hive: {
    name: 'Hive',
    tagline: 'Here comes the swarm',
    rules: [
      'Every {{batchInterval}}s releases a swarm of bees from the hive',
      'First swarm has {{batchStart}} bees, each later one adds 1, up to {{batchMax}}',
      'Bees chase and sting the enemy, -{{stingDamage}} per sting',
      'Bees live only {{beeLife}}s, up to {{maxBees}} on the field',
    ],
  },
  rocket: {
    name: 'Rocket',
    tagline: 'Aim, ignite!',
    rules: [
      'Bounces like a normal ball, its rocket nose pointing in the direction of travel',
      'Every {{dashCooldown}}s it stops to charge for {{chargeTime}}s, aiming its nose at the enemy',
      'Then ignites and dashes along that line at high speed for {{dashTime}}s, stopping at a wall',
      'The nose hits for -{{ramDamage}} and sends the enemy flying',
    ],
  },
  archer: {
    name: 'Archer',
    tagline: 'The arrow rain only gets heavier',
    rules: [
      "The bow always aims at the enemy's current position, firing straight arrows",
      'Each arrow hits for -{{arrowDamage}} and snaps on hitting a wall',
      'First arrow about {{firstShot}}s into the fight, then one every {{baseInterval}}s',
      'After {{rampStart}}s the fire rate keeps rising, ending at one every {{minInterval}}s: a stream of arrows',
    ],
  },
  knight: {
    name: 'Knight',
    tagline: 'Sword to strike, shield to guard',
    rules: [
      'Alternates sword and shield: sword for {{modeMin}}–{{modeMax}}s, shield for {{shieldMin}}–{{shieldMax}}s; starts with the sword',
      'Sword: swings {{swingAmplitudeDeg}}° to each side of the enemy direction, one full swing every {{swingPeriod}}s',
      'Blade hits for -{{swordDamage}} and knocks the enemy flying; at most once per {{swordCooldown}}s per target',
      'Shield: fully immune to damage; a {{fanArcDeg}}° shield fan faces the enemy and bounces it away on contact',
    ],
  },
  snake: {
    name: 'Snake',
    tagline: 'Grows longer, gets harder to dodge',
    rules: [
      'Trails {{startSegments}} body segments, growing one every {{growInterval}}s (up to {{maxSegments}})',
      'Every segment that touches the enemy deals -{{segmentDamage}}; several can bite at once',
      'Each segment bites at most once per {{segmentCooldown}}s',
      "The body doesn't block movement, so the enemy passes through; the head deals no damage",
    ],
  },
  apple: {
    name: 'Apple',
    tagline: 'An apple a day keeps the HP bar full',
    rules: [
      'Every {{throwInterval}}s tosses an apple in a random direction; it rolls and stops on the ground (up to {{maxApples}})',
      'An enemy stepping on a grounded apple takes -{{appleDamage}}',
      'Eating its own apple heals {{appleHeal}} HP, even above 100',
      'Apples still in the air do no damage',
    ],
  },
  shotgun: {
    name: 'Shotgun',
    tagline: 'Buckshot that keeps speeding up',
    rules: [
      'A shotgun slowly turns toward the enemy (up to {{turnDegrees}}°/s) and fires once loaded, aimed or not',
      'First shot {{firstShot}}s into the fight; each shot fires {{pellets}} pellets, -{{pelletDamage}} each',
      'Fire interval starts at {{intervalStart}}s and shrinks {{intervalShrinkPercent}}% per shot, down to {{intervalMin}}s',
      'Pellets vanish on hitting a wall; no recoil',
    ],
  },
  wdc: {
    name: 'WDC',
    tagline: 'Nine squares, one number',
    rules: [
      'Every {{cycleInterval}}s lays a 3×3 number grid over the whole arena for {{gridDuration}}s',
      'Most cells hold small numbers ({{smallMin}}–{{smallMax}}), but {{bigCells}} always hide big ones ({{bigMin}}–{{bigMax}})',
      'Strikes {{strikes}} times during the grid, each time picking the cell under the midpoint between the two balls',
      "The enemy takes that cell's number as damage, wherever it stands",
    ],
  },
  cactus: {
    name: 'Cactus',
    tagline: "All spines. Don't touch.",
    rules: [
      'Covered in spines: hitting the enemy deals -{{contactDamage}} (at most once per {{contactCooldown}}s)',
      'Pricking the enemy sprays {{seeds}} seeds all around ({{burstCooldown}}s cooldown); it also sprays on its own after too long without a hit',
      'Seeds grow into small cacti that deal -{{cactusDamage}} on enemy contact (once per {{cactusHitCooldown}}s each)',
      'Cacti last {{cactusLifetime}}s, then vanish as a batch; they never prick itself',
    ],
  },
  boxer: {
    name: 'Boxer',
    tagline: 'Five jabs, then the haymaker',
    rules: [
      'When the enemy is close, throws rapid alternating left-right punches, one every {{punchCooldown}}s',
      'Each jab hits for -{{jabDamage}}, no knockback',
      'Every {{comboHits}} hits it charges for {{chargeTime}}s, then lands a haymaker for -{{haymakerDamage}} that sends the enemy flying',
      'No collision damage and no healing',
    ],
  },
  phoenix: {
    name: 'Phoenix',
    tagline: 'Rises from the ashes',
    rules: [
      'Every {{volleyInterval}}s its wings beat, flinging {{feathers}} fire feathers out to the sides that curve toward the enemy',
      'Each feather hits for -{{featherDamage}}; feathers burn out on walls',
      'The first time its HP hits 0 it is reborn: back to {{rebirthHp}} HP, invulnerable for {{rebirthInvuln}}s, cleansed of poison, slow and disarm',
      'The rebirth blast hits enemies within {{burstRadius}} ball radii for -{{burstDamage}} and knocks them away; once per match',
      'Reborn, it beats faster: {{rebornFeathers}} feathers every {{rebornVolleyInterval}}s',
    ],
  },
  turtle: {
    name: 'Turtle',
    tagline: 'Hiding is an attack too',
    rules: [
      'When the enemy gets close, it snaps its neck out to bite for -{{biteDamage}}, at most once per {{biteCooldown}}s',
      'After taking {{shellTrigger}} damage it withdraws into its shell for {{shellTime}}s: invulnerable, {{shellSpeed}}× speed',
      'The shell launches at the enemy and re-aims at it off every wall; hits deal -{{shellDamage}} and knock the enemy away, at most once per {{shellHitCooldown}}s',
      'Damage taken in the {{shellCooldown}}s after popping out does not count toward the next withdrawal',
      "While disarmed it can't bite and the shell deals no damage",
    ],
  },
  mirror: {
    name: 'Mirror',
    tagline: 'Hit me and it comes back',
    rules: [
      'Reflects {{reflectPercent}}% of the damage enemies deal back at them; small hits add up',
      'Every {{beamInterval}}s banks a beam of light off the nearest wall into the enemy: -{{beamDamage}}',
      'The light path shows while aiming and locks just before firing, so it can be dodged',
      "While disarmed it can't fire but still reflects; reflected damage is never reflected again, and overtime drain isn't reflected",
    ],
  },
  thief: {
    name: 'Thief',
    tagline: "What's yours is mine",
    rules: [
      'No weapon of its own; when a steal is ready it sneaks towards the enemy (turning up to {{stalkTurnDeg}}°/s)',
      'Bumping the enemy steals its ability: -{{stealDamage}} and the enemy is disarmed for {{disarmTime}}s; at most one steal every {{stealCooldown}}s',
      'A stolen ability lasts {{lootTime}}s, and stealing the same one again extends it',
      'Robbing a thief takes its loot and robbing a mimic takes its current form; an empty-handed target gives a random ability; nothing can be stolen from an invulnerable enemy',
    ],
  },
  puffer: {
    name: 'Pufferfish',
    tagline: "Touch me and I'll puff",
    rules: [
      'No attack normally; every {{puffPeriod}}s it gulps and puffs up to {{puffScale}}x size, bristling with spikes',
      'While puffed, touching the enemy deals -{{spikeDamage}} and flings it away; at most once per {{hitCooldown}}s',
      'Stays puffed for {{holdTime}}s, then slowly deflates over {{deflateTime}}s; {{puffMass}}x heavier while puffed',
      "Can't puff while disarmed, held or rooted; disarmed spikes deal no damage",
    ],
  },
  snowball: {
    name: 'Snowball',
    tagline: 'Bigger with every roll',
    rules: [
      'Starts at {{startSize}}% size and grows as it rolls, reaching its max of {{maxSize}}% after about {{growTime}}s at full speed',
      'Ramming the enemy deals -{{minDamage}} to -{{maxDamage}}, more the bigger it is; at most once per {{ramCooldown}}s',
      'Each point of damage taken knocks off snow, shrinking it by {{shrinkPerDamage}}% (never below its starting size)',
      "Can't grow while held or rooted; rams deal no damage while disarmed",
    ],
  },
  gravity: {
    name: 'Gravity',
    tagline: 'The whole arena tilts',
    rules: [
      'Gravity pulls only the enemy towards one wall; Gravity itself floats free',
      'Every {{tiltInterval}}s the arena tilts and another wall becomes the floor, with a {{warnTime}}s warning',
      'Hitting the floor hard hurts: the harder the fall, the bigger the hit, up to -{{maxDamage}}',
      'Soft landings are harmless; no tilting while disarmed',
    ],
  },
  portal: {
    name: 'Portal',
    tagline: 'Out of the wall behind you',
    rules: [
      'Every {{portalInterval}}s opens a linked pair of wall portals (shrinking to every {{minInterval}}s), open for up to {{portalLife}}s',
      'Blue opens where it is about to hit a wall, orange on the wall nearest the enemy',
      "Any ball entering a portal (the enemy too) exits the other at the same speed; rooted or held balls can't pass",
      'After passing through, it dashes at the enemy for {{dashTime}}s, invulnerable and phasing through it; the hit deals -{{dashDamage}}',
      'The pair closes once it has passed through; no portals or dashes while disarmed',
    ],
  },
  sumo: {
    name: 'Sumo',
    tagline: 'The wall hits hardest',
    rules: [
      'Several times heavier than a normal ball, barely budges when hit',
      'Body contact shoves the enemy away hard, once every {{shoveCooldown}}s',
      'Stomps when the enemy gets close: -{{stompDamage}} and knocks it back, once every {{stompCooldown}}s',
      'A shoved enemy that hits a wall within {{slamWindow}}s takes -{{slamMinDamage}} to -{{slamMaxDamage}} from the wall, more the faster it hits',
      'No shoves or stomps while disarmed',
    ],
  },
  timeStop: {
    name: 'Time Stop',
    tagline: 'Time, stop!',
    rules: [
      'Stops time: the enemy is rooted and disarmed and the world turns grey; can stop time again {{stopCooldown}}s after it ends',
      'The first stop lasts {{stopStart}}s; each later one lasts {{stopGrowth}}s longer, up to {{stopMax}}s',
      'Keeps moving during the stop, throwing a knife every {{knifeInterval}}s that hangs in mid-air around the enemy',
      'When time resumes, every knife flies at the enemy at once: -{{knifeDamage}} each; misses fly on to the wall',
      'Between stops, throws a knife at the enemy every {{tossInterval}}s (also -{{knifeDamage}})',
    ],
  },
  echo: {
    name: 'Afterimage',
    tagline: 'My past self fights too',
    rules: [
      'Constantly records its own path; body contact deals no damage',
      'Every {{echoInterval}}s summons an afterimage (up to {{maxEchoes}} at once) that lasts {{echoLife}}s',
      'Each afterimage replays exactly what the ball did {{lagMin}}–{{lagMax}}s ago, picking the stretch most likely to hit the enemy',
      'Afterimages pass through everything; touching the enemy deals -{{echoDamage}}, at most once per {{hitCooldown}}s each',
      'No new afterimages while disarmed; existing ones still hurt',
    ],
  },
  voodoo: {
    name: 'Voodoo Doll',
    tagline: 'Stab the doll, hurt the foe',
    rules: [
      'Tosses a voodoo doll onto the field, as far from the enemy as it can',
      'Stabs the doll with a pin every {{stabInterval}}s: the enemy is hurt wherever it is, first pin -{{stabDamage}}',
      'Each further pin in the same doll deals {{stabGrowth}} more damage, up to -{{stabMax}}',
      'The enemy tears the doll apart by touching it; a new doll is tossed out {{dollRespawn}}s later',
    ],
  },
} satisfies LocaleShape<typeof zh>

export default characters
