// ==================== ISO GRID: mapping 23 zona ke grid ====================
// Format: id -> {gx, gy, gw, gd, floor, walls}
// floor: nama tile dari manifest. walls: 'window' | 'ornate' | 'plain' | null

const ISO_GRID = {
  // Northwest: Engineering cluster
  'engineering':   {gx:0,  gy:0,  gw:16, gd:10, floor:'floor_wood_a', walls:'window'},
  'specialized':   {gx:16, gy:0,  gw:14, gd:10, floor:'floor_wood_b', walls:'window'},
  'testing':       {gx:0,  gy:10, gw:8,  gd:6,  floor:'floor_wood_a', walls:'plain'},
  'security':      {gx:8,  gy:10, gw:8,  gd:6,  floor:'floor_marble', walls:'plain'},
  // Northeast: Business/Creative
  'marketing':     {gx:32, gy:0,  gw:14, gd:8,  floor:'floor_wood_a', walls:'window'},
  'design':        {gx:46, gy:0,  gw:10, gd:6,  floor:'floor_wood_b', walls:'window'},
  'gis':           {gx:56, gy:0,  gw:8,  gd:6,  floor:'floor_marble', walls:'plain'},
  'sales':         {gx:32, gy:8,  gw:8,  gd:6,  floor:'floor_wood_a', walls:'plain'},
  'paid-media':    {gx:40, gy:8,  gw:8,  gd:6,  floor:'floor_wood_b', walls:'plain'},
  'product':       {gx:48, gy:8,  gw:8,  gd:6,  floor:'floor_wood_a', walls:'plain'},
  // Southwest: Ops
  'academic':      {gx:0,  gy:18, gw:8,  gd:6,  floor:'floor_wood_b', walls:'plain'},
  'finance':       {gx:8,  gy:18, gw:8,  gd:6,  floor:'floor_marble', walls:'ornate'},
  'game-development':{gx:16,gy:18, gw:8, gd:6,  floor:'floor_greenscreen', walls:'plain'},
  'project-management':{gx:24,gy:18,gw:8, gd:6, floor:'floor_wood_a', walls:'plain'},
  // Southeast: Support
  'spatial-computing':{gx:32,gy:18,gw:8, gd:6,  floor:'floor_wood_b', walls:'plain'},
  'support':       {gx:40, gy:18, gw:8,  gd:6,  floor:'floor_wood_a', walls:'plain'},
  'healthcare':    {gx:48, gy:18, gw:8,  gd:5,  floor:'floor_marble', walls:'plain'},
  'research':      {gx:56, gy:18, gw:6,  gd:5,  floor:'floor_wood_b', walls:'plain'},
  // Social hub (selatan)
  'lobby':         {gx:8,  gy:28, gw:14, gd:8,  floor:'floor_marble', walls:'ornate'},
  'cafe':          {gx:24, gy:28, gw:12, gd:8,  floor:'floor_deck', walls:null},
  'musholla':      {gx:38, gy:28, gw:8,  gd:6,  floor:'floor_carpet_green', walls:'ornate'},
  'pool':          {gx:48, gy:28, gw:10, gd:8,  floor:'floor_coping', walls:null},
  'owner':         {gx:0,  gy:28, gw:6,  gd:6,  floor:'floor_rug_owner', walls:'ornate'},
  'meeting':       {gx:0,  gy:36, gw:10, gd:6,  floor:'floor_wood_a', walls:'window'},
};

// Props per zona (dipilih dari manifest)
const ISO_PROPS = {
  'engineering':   [['props','desk_long',3,2],['props','desk_long',7,2],['props','desk_long',11,2],['props','bookshelf',14,0]],
  'specialized':   [['props','desk_long',2,2],['props','desk_long',6,2],['props','desk_long',10,2]],
  'marketing':     [['props','desk_long',2,1],['props','desk_long',6,1],['props','desk_long',10,1],['props','corkboard',12,0]],
  'design':        [['props','desk_long',2,1],['props','desk_long',6,1]],
  'sales':         [['props','desk_long',2,1],['props','desk_long',5,1]],
  'lobby':         [['props','sofa_leather',2,2],['props','sofa_grey',6,2],['props','coffee_table',4,3],['props','plant_large',0,0],['props','plant_large',12,0]],
  'cafe':          [['props','bar_counter',2,1],['props','bar_stool',3,3],['props','bar_stool',5,3],['props','coffee_machine',9,0],['props','fridge_glass',10,0]],
  'musholla':      [['props','minbar',3,0]],
  'pool':          [['props','sun_lounger',2,2],['props','sun_lounger',5,2],['props','parasol',3,4],['props','palm',8,0]],
  'owner':         [['props','owner_desk',1,1],['props','leather_chair',2,3],['props','bookshelf',4,0]],
  'meeting':       [['props','table_round_set',3,1],['props','office_chair',2,3],['props','office_chair',5,3],['props','wall_tv',8,0]],
  'game-development':[['props','greenscreen',2,0],['props','ring_light',5,1],['props','camera_tripod',6,2],['props','desk_long',2,3]],
};

// Karakter default per divisi (dari 13 sprite)
const ISO_CHAR_MAP = {
  'owner': 'sofyan_owner',
  'musholla': 'jamaah_pria_peci', // saat sholat; default npc
  'security': 'satpam_slop',
  'marketing': 'publisher',
  'design': 'penulis',
  'research': 'arif_riset',
  'game-development': 'sutradara',
  'testing': 'qc_agent',
};
// default: npc_male_a / npc_female_hijab (bergantian)
function isoCharFor(agent){
  if(agent.id==='bos') return 'sofyan_owner';
  if(ISO_CHAR_MAP[agent.division]) return ISO_CHAR_MAP[agent.division];
  // hash: pria/wanita bergantian
  let h=0; for(const c of agent.id) h=(h*31+c.charCodeAt(0))>>>0;
  return h%2 ? 'npc_female_hijab' : 'npc_male_a';
}
