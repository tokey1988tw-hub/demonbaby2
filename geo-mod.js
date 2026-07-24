(function () {
    "use strict";

    // ===== 0. 取得遊戲全域（遊戲的 let/const 在全域語彙環境，主控台可直接以裸名存取）=====
    const G = (name) => { try { return eval(name); } catch (e) { return undefined; } };
    const hasFn = (name) => typeof G(name) === 'function';

    // ===== 1. 環境檢查 =====
    if (typeof DB === 'undefined' || !DB.items || typeof player === 'undefined') {
        alert("❌ 偵測失敗！請確定你正打開著「放置天堂」遊戲頁面，且已進入遊戲畫面再執行。");
        return;
    }

    // 取得真正的存檔位與存檔 key（修正：所有存檔位都是 lineage_idle_save_<slot>）
    const getSlot = () => {
        let s = G('currentSlot');
        if (s === undefined) s = window.currentSlot;
        return s || 1;
    };
    const slotKey = () => 'lineage_idle_save_' + getSlot();

    // 正確寫檔：優先用遊戲自帶 saveGame()（會寫對 key 與 {v,p,ms,ticks} 結構）；
    // 失敗才以正確結構手動寫入，避免掉版本號/地圖/tick。
    const doSave = () => {
        if (hasFn('saveGame')) {
            try { saveGame(); return true; } catch (e) { /* 落到手動 */ }
        }
        try {
            let ver = (typeof G('SAVE_VERSION') !== 'undefined') ? G('SAVE_VERSION') : 2;
            let ms = G('mapState') || {};
            let ticks = (G('state') && G('state').ticks) || 0;
            localStorage.setItem(slotKey(), JSON.stringify({ v: ver, p: player, ms: ms, ticks: ticks }));
            return true;
        } catch (e) { return false; }
    };

    // 即時刷新（不重整）：重算衍生值 + 刷新 UI
    const liveRefresh = () => {
        try { if (hasFn('calcStats')) calcStats(); else if (hasFn('recomputeStats')) recomputeStats(); } catch (e) {}
        try { if (hasFn('updateUI')) updateUI(); } catch (e) {}
        try { if (hasFn('renderTabs')) renderTabs(true); } catch (e) {}   // 強制重繪分頁（技能列表等）：確保解鎖/改動即時反映到 UI
    };

    // ===== 1a-2. 自創攻擊魔法：開機自動還原（DB.skills 只存在記憶體，重整網頁會消失；player.skills 的 id 有存檔會留著但變孤兒）=====
    //   跟存檔位無關，全角色/全分頁共用一份，key 固定 fb5_custom_skills。每次重跑修改器都會把之前建立過的全部補註冊回 DB.skills。
    const CUSTOM_SKILL_LS_KEY = 'fb5_custom_skills';
    function loadCustomSkillDefs() {
        try { return JSON.parse(localStorage.getItem(CUSTOM_SKILL_LS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function saveCustomSkillDefs(map) {
        try { localStorage.setItem(CUSTOM_SKILL_LS_KEY, JSON.stringify(map)); } catch (e) {}
    }
    (function restoreCustomSkills() {
        if (typeof DB === 'undefined' || !DB.skills) return;
        let saved = loadCustomSkillDefs();
        for (let id in saved) {
            let def = saved[id];
            if (!DB.skills[id]) DB.skills[id] = def;
            if (def && def.__animSrc && typeof SPELL_FX !== 'undefined' && SPELL_FX[def.__animSrc] && !SPELL_FX[def.n]) {
                SPELL_FX[def.n] = SPELL_FX[def.__animSrc];   // 🎬 重跑修改器時，把之前借用的動畫別名補回去
            }
        }
    })();

    // ===== 1b-2. 龍之鑽石（跨角色共用貨幣，資料獨立於角色存檔，見 js/24-pandora-relic-market.js）=====
    //   共用資料桶 fb5_pandora_relic_market_v1：LZ壓縮(_lzGet/_lzSet) + 簽章包裝(_saveWrap/_saveUnwrap)，皆為 00-data.js 的全域函式可直接呼叫。
    //   該檔案內部的 _readState/_writeState/_withStateLock 是模組私有閉包，外部無法呼叫；故此處以同等邏輯直接讀寫共用桶，
    //   只動 diamonds 欄位，其餘欄位（wanderers/boards/nameHistory…）原樣保留，缺欄位時遊戲下次讀取會自動補齊（_normalizeState）。
    const DIAMOND_KEY = 'fb5_pandora_relic_market_v1';
    const readDiamondState = () => {
        try {
            if (typeof _lzGet !== 'function') return null;
            let raw = _lzGet(DIAMOND_KEY);
            if (!raw) return null;
            let unwrapped = (typeof _saveUnwrap === 'function') ? _saveUnwrap(raw) : { payload: raw, ok: true };
            if (!unwrapped.ok || unwrapped.payload == null) return null;
            return JSON.parse(unwrapped.payload);
        } catch (e) { return null; }
    };
    const getDiamonds = () => { let st = readDiamondState(); return st ? Math.max(0, Math.floor(Number(st.diamonds) || 0)) : 0; };
    const setDiamonds = (value) => {
        let st = readDiamondState() || {};   // 尚未開啟過潘朵拉遺物市集：從最小物件開始，其餘欄位由遊戲下次讀取時自動補齊
        st.diamonds = Math.max(0, Math.floor(Number(value) || 0));
        st.updatedAt = Date.now();
        try {
            if (typeof _lzSet !== 'function' || typeof _saveWrap !== 'function') return false;
            return _lzSet(DIAMOND_KEY, _saveWrap(JSON.stringify(st))) !== false;
        } catch (e) { return false; }
    };
    // 🏪 清除遺物布告欄冷卻（boards[].cooldownUntil=0；跟龍之鑽石同一包共用資料，只動冷卻不動委託內容）
    const resetRelicBoards = () => {
        let st = readDiamondState();
        if (!st || !Array.isArray(st.boards)) return false;   // 從沒開過市集，沒有布告欄資料可清
        st.boards.forEach(b => { if (b) b.cooldownUntil = 0; });
        st.updatedAt = Date.now();
        try {
            if (typeof _lzSet !== 'function' || typeof _saveWrap !== 'function') return false;
            return _lzSet(DIAMOND_KEY, _saveWrap(JSON.stringify(st))) !== false;
        } catch (e) { return false; }
    };

    // ===== 1c. 自訂魔法武器：localStorage 持久化 + 啟動時重新注入 DB.items =====
    // 存檔只存物品實例(id/en)，不存武器本體定義；故把自訂規格存 localStorage，
    // 每次修改器載入時重新寫回 DB.items，確保重整後武器仍可用（須再次執行修改器）。
    const CW_KEY = 'geo_custom_weapons';
    const loadCustomWeapons = () => {
        try { return JSON.parse(localStorage.getItem(CW_KEY)) || {}; }
        catch (e) { return {}; }
    };
    const saveCustomWeapons = (obj) => {
        try { localStorage.setItem(CW_KEY, JSON.stringify(obj)); return true; }
        catch (e) { return false; }
    };
    // 把一筆規格組成 DB.items 條目（spellProc：發動率1%+強化×1%，傷害骰子×(1+強化/10)）
    const buildWeaponDef = (spec) => {
        // 發動機率：固定模式 → procRateBase=固定值, procRatePerEn=0；隨強化模式 → base=1, perEn=1（預設）
        const rateBase = (spec.procMode === 'fixed') ? (spec.procFixed || 1) : 1;
        const ratePerEn = (spec.procMode === 'fixed') ? 0 : 1;
        // 🖼️ 圖示：借用現有武器的圖（引擎用「物品名稱」組圖示路徑，自訂名字必定 404 → 直接借一張真實存在的圖）
        let borrowedImg = null;
        try { if (spec.iconFrom && DB.items[spec.iconFrom]) borrowedImg = (typeof getIconUrl === 'function') ? getIconUrl(DB.items[spec.iconFrom]) : DB.items[spec.iconFrom].img; } catch (e) {}
        const def = {
            n: spec.n, type: 'wpn',
            dmgS: spec.dmgS, dmgL: spec.dmgL, hit: spec.hit || 0,
            dmgBonus: spec.dmgBonus || 0, spd: spec.spd, req: spec.req || 'all',
            safe: 6, p: 1, legend: true, gachaWeight: 0,
            procRateBase: rateBase, procRatePerEn: ratePerEn,
            spellProc: { skn: spec.skn, dice: [spec.diceN, spec.diceF], ele: spec.ele },
            d: ''
        };
        if (borrowedImg) def.img = borrowedImg;
        // 📊 六圍被動加成（引擎原生：w.str/dex/con/int/wis/cha 於 recomputeStats 直接讀取）
        ['str','dex','con','int','wis','cha'].forEach(k => { if (spec[k]) def[k] = spec[k]; });
        // 發動率描述
        if (spec.procMode === 'fixed') def.d = `固定 ${rateBase}% 機率額外施放【${spec.skn}】（不隨強化變）`;
        else def.d = `1%機率額外施放【${spec.skn}】，每+1發動機率增加1%`;
        def.d += `；特效傷害 ${spec.diceN}D${spec.diceF}${spec.diceF>1?'×(1+強化/10)':''}，受魔法傷害影響${spec.ele !== 'none' ? '，含屬性剋制' : ''}`;
        // 🌐 攻擊全體
        if (spec.aoe) { def.spellProc.aoe = true; def.d += `；特效對敵方全體施放`; }
        def.d += '。';
        if (spec.isBow) { def.isBow = true; def.ranged = true; }
        if (spec.w2h) def.w2h = true;
        if (spec.isWand) def.isWand = true;   // 🪄 魔杖型態：即使自訂名字不含「杖」字，仍精準歸類（equipCatKey／isWandWeapon 判斷）
        if (spec.qigu) def.qigu = true;   // 👻 奇古獸型態：幻術士專屬分類旗標
        // 🩸 吸血/吸魔（引擎原生）
        if (spec.vampPct) { def.vampPct = spec.vampPct; def.d += ` 吸取一般攻擊傷害 ${Math.round(spec.vampPct * 100)}% 為 HP。`; }
        if (spec.mpOnHit) { def.mpOnHit = true; def.d += ` 命中時恢復 MP（1+max(0,強化-6)）。`; }
        if (spec.spHeal)  { def.spellProc.heal = spec.spHeal; def.d += ` 施放特效時回復特效傷害 ${Math.round(spec.spHeal * 100)}% 的 HP。`; }
        return def;
    };
    // 啟動時重新注入所有自訂武器
    (function reinjectCustomWeapons() {
        const all = loadCustomWeapons();
        let n = 0;
        Object.entries(all).forEach(([id, spec]) => { DB.items[id] = buildWeaponDef(spec); n++; });
        if (n > 0) console.log(`[修改器] 已重新注入 ${n} 把自訂魔法武器到 DB.items`);
    })();
    // 👹 裝備時變身（比照真．冥皇執行劍：找不到中段安全掛點可插入 p._setPoly 管線，改用「藥水變身」p.poly/buffs.poly 管線——
    //   recomputeStats 只讀取不重置這兩個欄位，故可在呼叫前設定，正確被下游攻速/外觀選取採用；優先序天然低於套裝 _setPoly，卸下即清除）
    (function hookEquipMorph() {
        const orig = (typeof window.recomputeStats === 'function') ? window.recomputeStats : null;
        if (!orig || window._cwMorphHooked) return;
        window.recomputeStats = function () {
            try {
                const w = player.eq && player.eq.wpn;
                const spec = (w && w.id && w.id.indexOf('wpn_custom_') === 0) ? (loadCustomWeapons()[w.id]) : null;
                if (spec && spec.morphName && typeof findPolyForm === 'function') {
                    const pf = findPolyForm(spec.morphName);
                    if (pf) { player.poly = pf.form; player.buffs.poly = 999999; player._cwMorphActive = true; }
                    else if (player._cwMorphActive) { player.poly = null; player.buffs.poly = 0; player._cwMorphActive = false; }
                } else if (player._cwMorphActive) {
                    player.poly = null; player.buffs.poly = 0; player._cwMorphActive = false;
                }
            } catch (e) {}
            return orig.apply(this, arguments);
        };
        window._cwMorphHooked = true;
    })();

    // ===== 1c-2. 自訂防具/飾品：localStorage 持久化 + 啟動時重新注入 DB.items（架構同 1c 武器）=====
    const CA_KEY = 'geo_custom_armors';
    const loadCustomArmors = () => { try { return JSON.parse(localStorage.getItem(CA_KEY)) || {}; } catch (e) { return {}; } };
    const saveCustomArmors = (obj) => { try { localStorage.setItem(CA_KEY, JSON.stringify(obj)); return true; } catch (e) { return false; } };
    const ACC_SLOTS = ['ring', 'amulet', 'ear'];
    const buildArmorDef = (spec) => {
        let borrowedImg = null;
        try { if (spec.iconFrom && DB.items[spec.iconFrom]) borrowedImg = (typeof getIconUrl === 'function') ? getIconUrl(DB.items[spec.iconFrom]) : DB.items[spec.iconFrom].img; } catch (e) {}
        const itemType = ACC_SLOTS.indexOf(spec.slot) >= 0 ? 'acc' : 'arm';
        const def = { n: spec.n, type: itemType, slot: spec.slot, ac: spec.ac || 0, req: spec.req || 'all', safe: 6, p: 1, legend: true, gachaWeight: 0, d: '' };
        if (borrowedImg) def.img = borrowedImg;
        ['str','dex','con','int','wis','cha','mhp','mmp','hpR','mpR','mr','er','dr','resFire','resWater','resWind','resEarth'].forEach(k => { if (spec[k]) def[k] = spec[k]; });
        let parts = [];
        if (spec.ac) parts.push(`防禦+${spec.ac}`);
        ['mhp','mmp','hpR','mpR','mr','er','dr'].forEach(k => { if (spec[k]) parts.push(`${k}+${spec[k]}`); });
        ['str','dex','con','int','wis','cha'].forEach(k => { if (spec[k]) parts.push(`${k}+${spec[k]}`); });
        ['resFire','resWater','resWind','resEarth'].forEach(k => { if (spec[k]) parts.push(`${k}+${spec[k]}`); });
        def.d = parts.length ? parts.join('、') + '。' : '自訂裝備。';
        return def;
    };
    (function reinjectCustomArmors() {
        const all = loadCustomArmors();
        let n = 0;
        Object.entries(all).forEach(([id, spec]) => { DB.items[id] = buildArmorDef(spec); n++; });
        if (n > 0) console.log(`[修改器] 已重新注入 ${n} 件自訂防具/飾品到 DB.items`);
    })();

    // 🔁 重拔完成後立即重算數值：DB.items 補回自訂武器/裝備定義前，遊戲開機時已跑過一次 calcStats()，
    //    若已裝備的自訂物品當時查不到定義，其屬性/特效（含自動魔法 spellProc）就完全沒被算進當下的角色數值，
    //    要等到下一次自然觸發重算（升級、重新裝備等）才會生效。這裡補一次立即重算，修正「開修改器後魔法沒套入」。
    try { if (typeof calcStats === 'function') calcStats(); } catch (e) { console.warn('[修改器] 重拔後重算數值失敗', e); }

    // ===== 1d. 妖精全屬性魔法解鎖（C 方案：拔除 DB.skills 的 reqEle/reqEleAny）=====
    // 原理：屬性檢查全是 `sk.reqEle && elfEle !== sk.reqEle`，把 reqEle 設為 undefined → 整段 falsy 跳過，
    // 屬性限制失效；但等級(needLv)、MP、是否已學完全不受影響（仍須符合）。
    // reqEle 屬 DB 層，重整會還原 → 每次載入修改器自動重拔（與自訂武器同模式）。
    const ELF_ELE_KEY = 'geo_elf_all_ele';
    const isElfEleUnlocked = () => { try { return localStorage.getItem(ELF_ELE_KEY) === '1'; } catch (e) { return false; } };
    // 備份原始 reqEle/reqEleAny，方便還原
    const _elfEleBackup = {};
    const applyElfAllEle = () => {
        if (!DB.skills) return 0;
        let n = 0;
        for (let id in DB.skills) {
            let sk = DB.skills[id];
            if (sk && (sk.reqEle || sk.reqEleAny)) {
                if (!(id in _elfEleBackup)) _elfEleBackup[id] = { reqEle: sk.reqEle, reqEleAny: sk.reqEleAny };
                delete sk.reqEle; delete sk.reqEleAny;
                n++;
            }
        }
        return n;
    };
    const restoreElfAllEle = () => {
        let n = 0;
        for (let id in _elfEleBackup) {
            let b = _elfEleBackup[id];
            if (DB.skills[id]) {
                if (b.reqEle !== undefined) DB.skills[id].reqEle = b.reqEle;
                if (b.reqEleAny !== undefined) DB.skills[id].reqEleAny = b.reqEleAny;
                n++;
            }
        }
        return n;
    };
    // 啟動時：若已開啟則自動套用
    if (isElfEleUnlocked()) {
        let n = applyElfAllEle();
        if (n > 0) console.log(`[修改器] 妖精全屬性魔法已解鎖（拔除 ${n} 個技能的屬性限制）`);
    }

    // ===== 1e. 六圍突破 80：hook 效果表，80 以上線性外推（越高越強）=====
    // 遊戲在 recomputeStats 把 d.str..cha 夾到 ≤80，且效果表(getStrMeleeDmg…)80封頂。
    // 作法：包裝各效果表函式，偵測到玩家「真實六圍」(base+alloc+panacea) >80 時，改用真實值線性外推。
    // 純公式型(getConGrowth/getWisGrowth)本就無上限，但被夾擠擋住 → 另在 recompute 後補回 HP/MP 成長差額。
    const STAT_CAP_KEY = 'geo_stat_break80';
    const isStatBreakOn = () => { try { return localStorage.getItem(STAT_CAP_KEY) === '1'; } catch (e) { return false; } };
    // 真實六圍（不受夾擠影響）
    const realStat = (k) => {
        try {
            let b = player.base || {}, a = player.alloc || {}, pn = player.panacea || {};
            return (b[k] || 0) + (a[k] || 0) + (pn[k] || 0);
        } catch (e) { return 0; }
    };
    // 效果表外推設定：函式名 → { stat:對應六圍, base:80封頂值, per:每點增量 }
    const EXTRAP = {
        getStrMeleeDmg:   { s: 'str', base: 45, per: 0.5 },
        getStrMeleeHit:   { s: 'str', base: 60, per: 1.0 },
        getStrMeleeCrit:  { s: 'str', base: 9,  per: 0.1 },
        getDexRangedDmg:  { s: 'dex', base: 36, per: 0.5 },
        getDexRangedHit:  { s: 'dex', base: 74, per: 1.0 },
        getDexRangedCrit: { s: 'dex', base: 8,  per: 0.1 },
        getIntMagicDmg:   { s: 'int', base: 25, per: 0.5 },
        getIntMagicHit:   { s: 'int', base: 25, per: 0.5 },
        getIntMagicCrit:  { s: 'int', base: 11, per: 0.1 },
        getIntExtraMp:    { s: 'int', base: 25, per: 0.5 },
        getConHpRegenMax: { s: 'con', base: 45, per: 0.5 },
        getConPotionPct:  { s: 'con', base: 13, per: 0.1 },
        getWisMpRegen:    { s: 'wis', base: 27, per: 0.5 },
        getWisMpOnKill:   { s: 'wis', base: 16, per: 0.3 },
        getWisBlueBonus:  { s: 'wis', base: 38, per: 0.5 }
        // 註：getDexER(封60)、getWisMR(封60)、getIntMpReduce(封45)為設計硬上限，不外推
    };
    const _statHookOrig = {};   // 原始函式備份
    const applyStatBreak = () => {
        let n = 0;
        for (let fn in EXTRAP) {
            if (typeof window[fn] !== 'function') continue;
            if (!_statHookOrig[fn]) _statHookOrig[fn] = window[fn];
            const orig = _statHookOrig[fn];
            const cfg = EXTRAP[fn];
            window[fn] = function (v) {
                // 若玩家真實六圍 > 80，改用真實值外推；否則原樣
                let rv = realStat(cfg.s);
                if (rv > 80) return Math.floor(cfg.base + (rv - 80) * cfg.per);
                return orig(v);
            };
            n++;
        }
        // 純公式型 HP/MP 成長（本無上限，但被夾擠擋住）：改讀真實 con/wis
        if (typeof window.getConGrowth === 'function') {
            if (!_statHookOrig.getConGrowth) _statHookOrig.getConGrowth = window.getConGrowth;
            const oc = _statHookOrig.getConGrowth;
            window.getConGrowth = function (con, cls) { let rv = realStat('con'); return oc(rv > 80 ? rv : con, cls); };
            n++;
        }
        if (typeof window.getWisGrowth === 'function') {
            if (!_statHookOrig.getWisGrowth) _statHookOrig.getWisGrowth = window.getWisGrowth;
            const ow = _statHookOrig.getWisGrowth;
            window.getWisGrowth = function (wis) { let rv = realStat('wis'); return ow(rv > 80 ? rv : wis); };
            n++;
        }
        return n;
    };
    const restoreStatBreak = () => {
        let n = 0;
        for (let fn in _statHookOrig) { window[fn] = _statHookOrig[fn]; n++; }
        return n;
    };
    if (isStatBreakOn()) {
        let n = applyStatBreak();
        if (n > 0) console.log(`[修改器] 六圍突破80已啟用（${n} 個效果表改為線性外推）`);
    }

    // ===== 1f. 戰鬥節奏修改（攻擊間隔/施法冷卻/硬直）+ 怪物重生加速 =====
    // 前三者為 recomputeStats 衍生值(d.aspd/d.castLock/d.hitstun)，每次重算會被覆蓋 → hook recompute 後補寫。
    // 怪物重生用獨立 setInterval 壓 mapState.spawnAt（不碰變身系統），BOSS房/軍王之室不加速。
    const TEMPO_KEY = 'geo_combat_tempo';
    const loadTempo = () => {
        try { return JSON.parse(localStorage.getItem(TEMPO_KEY)) || {}; } catch (e) { return {}; }
    };
    const saveTempo = (o) => { try { localStorage.setItem(TEMPO_KEY, JSON.stringify(o)); } catch (e) {} };
    // 套用戰鬥節奏到 player.d（在 recompute 之後呼叫）。值為空字串/undefined = 不改該項。
    const applyTempoToStats = () => {
        const t = loadTempo();
        if (!t.on || !player || !player.d) return;
        // 攻擊間隔（秒）：下限 0.1（引擎 aspdTicks=max(1,floor(aspd*10)) → 0.1秒=1tick 為極限）
        if (t.aspd !== '' && t.aspd != null) player.d.aspd = Math.max(0.1, Number(t.aspd));
        // 施法冷卻（tick）：下限 0
        if (t.castLock !== '' && t.castLock != null) player.d.castLock = Math.max(0, Math.floor(Number(t.castLock)));
        // 硬直（tick）：下限 0
        if (t.hitstun !== '' && t.hitstun != null) player.d.hitstun = Math.max(0, Math.floor(Number(t.hitstun)));
    };
    // 怪物重生加速：定時把未來排程壓成「當前 tick」讓其立即重生（BOSS房不動）
    let _respawnTimer = null;
    const startRespawnAccel = () => {
        if (_respawnTimer) return;
        _respawnTimer = setInterval(() => {
            try {
                const t = loadTempo();
                if (!t.on || !t.fastRespawn) return;
                if (typeof mapState === 'undefined' || !mapState || !Array.isArray(mapState.spawnAt)) return;
                // BOSS 房 / 軍王之室不加速（維持遊戲節奏與鑰匙機制）
                if (typeof KING_ROOMS !== 'undefined' && KING_ROOMS[mapState.current]) return;
                if (typeof PURE_BOSS_MAPS !== 'undefined' && PURE_BOSS_MAPS.indexOf && PURE_BOSS_MAPS.indexOf(mapState.current) >= 0) return;
                if (typeof mapState.current === 'string' && mapState.current.indexOf('siege_v2_') === 0) return;   // 🏰 攻城v2：波次/BOSS獨佔位自有節奏，不套用加速
                const now = (typeof state !== 'undefined' && state) ? state.ticks : null;
                if (now == null) return;
                for (let i = 0; i < mapState.spawnAt.length; i++) {
                    if (mapState.spawnAt[i] != null && mapState.spawnAt[i] > now) mapState.spawnAt[i] = now;   // 壓成當前 tick → 下個 tick 立即重生
                }
            } catch (e) {}
        }, 200);   // 每 0.2 秒巡一次
    };
    const stopRespawnAccel = () => { if (_respawnTimer) { clearInterval(_respawnTimer); _respawnTimer = null; } };
    // 啟動時：若開著就掛 recompute hook + 重生加速
    const _origRecompute_tempo = (typeof window.recomputeStats === 'function') ? window.recomputeStats : null;
    (function initTempo() {
        const t = loadTempo();
        if (!t.on) return;
        // hook recomputeStats：跑完原邏輯後補寫戰鬥節奏
        if (_origRecompute_tempo && !window._tempoHooked) {
            window.recomputeStats = function () { let r = _origRecompute_tempo.apply(this, arguments); applyTempoToStats(); return r; };
            window._tempoHooked = true;
        }
        applyTempoToStats();
        startRespawnAccel();
        console.log('[修改器] 戰鬥節奏修改已套用');
    })();

    // ===== 1g. 傭兵上限修改（hook allyActiveCap，可自訂同時上場人數）=====
    // 遊戲 ALLY_ACTIVE_MAX=3 為 const 改不到，但 allyActiveCap() 為全域函式可覆寫。
    const ALLYCAP_KEY = 'geo_ally_cap';
    const loadAllyCap = () => { try { return localStorage.getItem(ALLYCAP_KEY); } catch (e) { return null; } };
    const _origAllyCap = (typeof window.allyActiveCap === 'function') ? window.allyActiveCap : null;
    const applyAllyCap = (n) => {
        window.allyActiveCap = function () { return n; };
    };
    const restoreAllyCap = () => { if (_origAllyCap) window.allyActiveCap = _origAllyCap; };
    (function initAllyCap() {
        const v = loadAllyCap();
        if (v == null) return;
        const n = parseInt(v);
        if (n > 0) { applyAllyCap(n); console.log(`[修改器] 傭兵上限已改為 ${n} 名`); }
    })();

    // ===== 1h. 迷魅術可迷魅 BOSS ＋ 迷魅怪繼承魔法（統一 manualCast 包裝·一律安裝·旗標判斷）=====
    // 迷魅術 type:"manual" → 走 manualCast。boss/noCharm 阻擋 + abnormalMagicHit≤60%。
    // 繼承魔法：迷魅成功後怪會被移除，故施放「前」先擷取目標怪最強傷害型法術(mag/mag2/mag3)→轉召喚 proc
    //   存於 player.charmed._magProc，由 summonTick 依旗標啟用（可事後切換·不需重新迷魅）。
    // 注意：遊戲(js/09)已包裝過 manualCast(變身觸發)，以「當前 window.manualCast」為原始函式保留包裝。
    const CHARM_KEY = 'geo_charm_boss';
    const isCharmBossOn = () => { try { return localStorage.getItem(CHARM_KEY) === '1'; } catch (e) { return false; } };
    const CHARMMAG_KEY = 'geo_charm_magic';   // {on}
    const loadCharmMag = () => { try { return JSON.parse(localStorage.getItem(CHARMMAG_KEY)) || {}; } catch (e) { return {}; } };
    const saveCharmMag = (o) => { try { localStorage.setItem(CHARMMAG_KEY, JSON.stringify(o)); } catch (e) {} };
    const isCharmMagicOn = () => !!loadCharmMag().on;
    // 怪法術 → 召喚 proc（只取傷害型·挑期望值最高一支；狀態型召喚 proc 不支援·略過）
    const _bestMobMagProc = (t) => {
        let best = null, bestMean = -1;
        ['mag', 'mag2', 'mag3'].forEach(k => {
            const m = t && t[k];
            if (!m || !Array.isArray(m.dmg)) return;
            const mean = (m.dmg[0] || 1) * ((m.dmg[1] || 1) + 1) / 2;
            if (mean > bestMean) { bestMean = mean; best = m; }
        });
        if (!best) return null;
        const cd = Math.max(10, best.cd || 30);
        return { p: (best.chance != null ? best.chance : 1), cd: cd, cdCur: cd, dmgDice: best.dmg.slice(), ele: best.ele || 'none', name: best.skn || '魔法' };
    };
    (function hookManualCastUnified() {
        if (typeof window.manualCast !== 'function' || window._charmUnifiedHooked) return;
        const orig = window.manualCast;   // 保留遊戲已包裝的變身觸發
        window.manualCast = function (skId) {
            if (skId === 'sk_charm') {
                let t = null;
                try { t = (typeof getTarget === 'function') ? getTarget() : null; } catch (e) {}
                const magSnap = t ? _bestMobMagProc(t) : null;   // 施放「前」擷取（成功後怪會消失）
                const prevCharmed = player.charmed;
                let ret;
                if (isCharmBossOn() && t) {
                    const _b = t.boss, _nc = t.noCharm;
                    t.boss = false; t.noCharm = false;   // 暫拔阻擋標籤
                    const _hb = (typeof window.abnormalMagicHit === 'function') ? window.abnormalMagicHit : null;
                    if (_hb) window.abnormalMagicHit = function () { return true; };   // 暫時必中
                    try { ret = orig.apply(this, arguments); }
                    finally { t.boss = _b; t.noCharm = _nc; if (_hb) window.abnormalMagicHit = _hb; }
                } else {
                    ret = orig.apply(this, arguments);
                }
                // 迷魅成功（新的 charmed）→ 記下該怪法術（旗標開才由 summonTick 啟用）
                try { if (player.charmed && player.charmed !== prevCharmed && magSnap) player.charmed._magProc = magSnap; } catch (e) {}
                return ret;
            }
            return orig.apply(this, arguments);
        };
        window._charmUnifiedHooked = true;
        window._charmBossHooked = true;   // 相容舊 handler 的成功檢查
    })();
    const applyCharmBoss = () => {};      // 相容舊 handler：hook 已一律安裝·開關改由旗標
    const restoreCharmBoss = () => {};
    console.log('[修改器] 迷魅 manualCast 統一包裝已安裝（迷魅BOSS' + (isCharmBossOn() ? '·開' : '·關') + '／繼承魔法' + (isCharmMagicOn() ? '·開' : '·關') + '）');

    // ===== 1i. 召喚指定 BOSS（v3.2.19 召喚術 v2 相容版）=====
    // 舊版 hook buildSummon 已失效：sk_summon / sk_elf_summon2 改走 js/23 的 summonV2CastFor（多實體·player.summonsV2）。
    // 新做法：hook _sumDeriveAny（召喚術傷害）＋ spiritAttackOnce（強力精靈改走物理）＋ summonV2CastFor（施放/自動重召後改名/保圖/染屬性）。
    // BOSS 老數值換算成 v2 尺度（flat+1D dice）；BOSS 資料格式：[名稱, 等級, dmg[0], dmg[1], 攻速秒, 屬性]
    const SUMMON_BOSSES = [["吉爾塔斯",99,5,158,2,"none"],["真．死亡騎士 冥皇丹特斯",99,2,40,0.25,"none"],["長老．巴陸德",96,2,200,2,"none"],["巴拉卡斯",95,3,350,4,"fire"],["安塔瑞斯",93,2,250,1.5,"earth"],["法利昂",93,2,350,2,"water"],["長老．拉曼斯",93,1,196,1,"none"],["長老．安迪斯",91,2,182,2,"none"],["林德拜爾",90,2,200,1,"wind"],["長老．泰瑪斯",90,2,180,2,"none"],["長老．巴洛斯",88,2,230,3,"none"],["長老．巴塔斯",85,1,170,1,"none"],["長老．艾迪爾",80,2,160,2,"none"],["不滅的巫妖",80,4,80,2,"none"],["邪惡的鐮刀死神",80,5,80,1.5,"none"],["長老．琪娜",78,4,78,2,"none"],["冰之女王",75,4,75,2,"water"],["闇黑的騎士范德",75,2,75,1,"none"],["底比斯 阿努比斯",70,3,140,3,"wind"],["底比斯 賀洛斯",70,3,70,2,"water"],["冥法軍王海露拜",70,6,63,2,"earth"],["混沌",70,4,61,2,"none"],["死亡",70,1,151,1,"none"],["提卡爾杰弗雷庫(雄)",70,4,92,3,"earth"],["提卡爾杰弗雷庫(雌)",70,4,92,2,"none"],["墮落",68,1,100,1,"water"],["冰魔",65,2,130,2,"none"],["法令軍王蕾雅",65,4,63,2,"earth"],["地獄的黑豹",65,1,165,1,"none"],["不死的木乃伊王",65,1,105,1,"none"],["冷酷的艾莉絲",65,1,65,0.5,"none"],["魔獸軍王巴蘭卡",63,3,63,0.5,"water"],["死亡的殭屍王",62,3,150,3,"none"],["惡魔",61,6,66,1,"earth"],["暗殺軍王史雷佛",61,4,63,1,"none"],["扭曲的潔尼斯女王",60,2,120,2,"none"],["不幸的幻象眼魔",60,2,120,2,"none"],["恐怖的吸血鬼",60,2,150,2,"earth"],["深淵之主",60,3,100,2,"none"],["不死鳥",59,1,260,1.2,"fire"],["巨蟻女皇",57,1,200,1.5,"earth"],["古代巨人",56,2,112,2,"earth"],["巴列斯",53,1,100,1.5,"earth"],["遺忘之島巨大牛人",53,1,150,3,"earth"],["卡瑞",52,1,70,0.9,"earth"],["死亡騎士",52,1,100,0.8,"earth"],["克特",51,1,70,1,"none"],["卡魯塔",51,4,70,2,"wind"],["黑長者",50,1,150,2,"none"],["變形怪首領",50,1,100,2,"wind"],["巴風特",50,1,100,1.5,"earth"],["飛龍",48,1,100,1,"wind"],["馬庫爾",45,1,120,2,"none"],["伊弗利特",45,1,130,1.5,"fire"],["卡士柏",44,3,70,2,"none"],["夢幻之島火精靈王",43,3,41,2,"fire"],["夢幻之島水精靈王",43,3,21,2,"water"],["夢幻之島風精靈王",43,3,41,1,"wind"],["夢幻之島地精靈王",43,2,61,3,"earth"],["獨角獸",43,2,31,1.5,"earth"],["巴土瑟",43,3,45,2,"none"],["西瑪",42,4,31,2,"none"],["德雷克",42,2,84,2,"earth"],["夢魘",40,1,100,1.5,"none"],["肯特守護塔",1,0,0,2,"none"],["肯特城門",1,0,0,2,"none"],["海音守護塔",1,0,0,2,"none"],["海音城門",1,0,0,2,"none"],["風木守護塔",1,0,0,2,"none"],["風木城門",1,0,0,2,"none"],["往上層的樓梯",1,1,1,60,"none"],["遺忘之島",1,1,1,60,"none"]];
    const SUMMONBOSS_KEY = 'geo_summon_boss';   // 存 {on, idx, mult}
    const loadSummonBoss = () => { try { return JSON.parse(localStorage.getItem(SUMMONBOSS_KEY)) || {}; } catch (e) { return {}; } };
    const saveSummonBoss = (o) => { try { localStorage.setItem(SUMMONBOSS_KEY, JSON.stringify(o)); } catch (e) {} };
    const TARGET_SUMMON_SKILLS = ['sk_summon', 'sk_elf_summon2'];   // v2：僅這兩技走本模組（玩家）

    // 🔧 取遊戲全域函式（js/23 的 function 宣告掛在 window·同舊 buildSummon hook 原理；退而用 eval 兜底）
    const _fn = (name) => (typeof window[name] === 'function') ? window[name] : (hasFn(name) ? G(name) : null);

    // BOSS 老數值 → v2 尺度：老 dmgDice=[d0,d1]（每擊期望 d0×(d1+1)/2），
    //   套 v2 的 flat+1D(dice) 模型（同 _sumDerive 的 0.55 拆分）、攻速秒→tick、dmgMult=1（打出≈BOSS數值×倍率）。
    const _bossDeriveFor = (orig, b, mult) => {
        const d0 = b[2] || 1, d1 = b[3] || 1, aspdSec = b[4] || 2;
        const mean = (d0 * (d1 + 1) / 2) * (mult || 1);
        const flat = Math.max(0, Math.round(mean * 0.55));
        const dice = Math.max(1, Math.round((mean - flat) * 2));
        // ⚠ 強力精靈的 _spiritDerive 只回 {aspd,ac,dr}·無 hit；導去 summonV2AttackOnce 需要 d.hit → 缺就補命中回退
        let hit = orig && orig.hit;
        if (hit == null) {
            const shf = _fn('_sumScaledHit');
            hit = shf ? shf(b[1] || 50, 10, !!(player && player.mastery === 'm_summon')) : (((player && player.lv) || 1) + 40);
        }
        return Object.assign({}, orig, { flat: flat, dice: dice, hit: hit, aspd: Math.max(5, Math.round(aspdSec * 10)), dmgMult: 1 });
    };
    const _bossCfgActive = (skId) => { const c = loadSummonBoss(); return (c.on && TARGET_SUMMON_SKILLS.indexOf(skId) >= 0) ? c : null; };

    // ⚡ 召喚/迷魅 命中+攻速強化（獨立開關·與 BOSS/不死可同時開）
    const SUMMON_V2_ALL = ['sk_summon', 'sk_zombie', 'sk_elf_summon', 'sk_elf_summon2'];   // 全 v2 召喚都吃強化
    const SCBUFF_KEY = 'geo_sc_buff';   // {on, hitAdd, aspdMult}（aspdMult 越小越快·1=原速）
    const loadSCBuff = () => { try { return JSON.parse(localStorage.getItem(SCBUFF_KEY)) || {}; } catch (e) { return {}; } };
    const saveSCBuff = (o) => { try { localStorage.setItem(SCBUFF_KEY, JSON.stringify(o)); } catch (e) {} };

    // 🩸 怪表 DB.mobs 名稱→真實血量（供「召喚血量跟著 BOSS」用；找不到就維持原血量）
    const _mobHpByName = {};
    try { if (typeof DB !== 'undefined' && DB.mobs) { for (let id in DB.mobs) { const m = DB.mobs[id]; if (m && m.n && m.hp) _mobHpByName[m.n] = m.hp; } } } catch (e) {}
    const _bossHpFor = (name) => _mobHpByName[name] || 0;

    // ── hook 1：_sumDeriveAny（召喚術 sk_summon 傷害/攻速·受擊防禦亦經此）──
    (function hookSumDerive() {
        const orig = _fn('_sumDeriveAny');
        if (!orig || window._sumBossDeriveHooked) return;
        window._sumDeriveAny = function (s) {
            let d = orig.call(this, s);
            const c = s && _bossCfgActive(s.skId);
            if (c) { const b = SUMMON_BOSSES[c.idx || 0]; if (b) d = _bossDeriveFor(d, b, Math.max(0.1, Number(c.mult) || 1)); }
            // ⚡ 召喚 命中+攻速強化（所有 v2 召喚·boss 轉換後再套）
            const bf = loadSCBuff();
            if (bf.on && s && SUMMON_V2_ALL.indexOf(s.skId) >= 0) {
                d = Object.assign({}, d, {
                    hit: (d.hit || 0) + (Number(bf.hitAdd) || 0),
                    aspd: Math.max(3, Math.round((d.aspd || 20) * (Number(bf.aspdMult) || 1)))
                });
            }
            return d;   // 保留原 ac/dr（被打防禦維持正常縮放）
        };
        window._sumBossDeriveHooked = true;
    })();

    // ── hook 2：spiritAttackOnce（強力精靈走元素公式·不經 _sumDeriveAny）→ boss 時改走召喚術物理路徑（可預期）──
    // ⚠ v3.3.23 起新增第3參數 owner（傭兵精靈召喚亦走此函式·owner=ally）：務必轉發 owner，且 boss 轉換僅限「僅玩家」（owner===player）。
    (function hookSpiritAttack() {
        const orig = _fn('spiritAttackOnce');
        const atk = _fn('summonV2AttackOnce');
        if (!orig || window._spiritBossHooked) return;
        window.spiritAttackOnce = function (s, t, owner) {
            const _own = owner || player;
            if (_own === player && s && s.skId === 'sk_elf_summon2' && _bossCfgActive(s.skId) && atk && typeof window._sumDeriveAny === 'function') {
                return atk.call(this, s, window._sumDeriveAny(s), t, _own);   // 以 boss 化的 d 打物理（不吃魔抗亂跳）
            }
            return orig.call(this, s, t, owner);   // 轉發原始 owner（含 undefined）：傭兵精靈召喚正確歸屬 ally
        };
        window._spiritBossHooked = true;
    })();

    // ── hook 3：summonV2CastFor（施放/自動重召後把名字改 BOSS·formGfx 保原圖·染 BOSS 屬性）──
    (function hookSummonCast() {
        const orig = _fn('summonV2CastFor');
        if (!orig || window._summonCastBossHooked) return;
        window.summonV2CastFor = function (skId, silent) {
            const ok = orig.call(this, skId, silent);
            try {
                const c = ok && _bossCfgActive(skId);
                if (c && player && Array.isArray(player.summonsV2)) {
                    const b = SUMMON_BOSSES[c.idx || 0];
                    const mult = Math.max(0.1, Number(c.mult) || 1);
                    if (b) {
                        const bhp = _bossHpFor(b[0]);   // 🩸 召喚血量跟著 BOSS（查 DB.mobs 真實血量）
                        player.summonsV2.forEach(s => {
                            if (s._bossOrigForm == null) s._bossOrigForm = s.form;
                            s.formGfx = s.formGfx || s._bossOrigForm;   // 保住戰場圖（js/22 用 formGfx||form）
                            s.form = '召喚：' + b[0] + (mult !== 1 ? ('×' + mult) : '');
                            if (b[5] && b[5] !== 'none') s.ele = b[5];
                            if (bhp > 0) { s.mhp = bhp; s.hp = bhp; }   // 血量換成 BOSS 真實血量（找不到則維持原血）
                        });
                        if (typeof window.renderSummonPanel === 'function') window.renderSummonPanel(true);
                    }
                }
            } catch (e) {}
            return ok;
        };
        window._summonCastBossHooked = true;
    })();

    // 立即重套用：有目標召喚在場時免 MP 重召一次（開/關 boss 都用它即時反映；經 hook3 重新命名或還原原貌）
    const reSummonV2 = () => {
        try {
            const skFn = _fn('summonV2ActiveSk');
            const sk = skFn ? skFn() : ((player && player._summonV2Sk) || 'sk_summon');
            const knowsFn = _fn('summonV2Knows');
            const cast = _fn('summonV2CastFor');
            if (player && player._summonV2On && TARGET_SUMMON_SKILLS.indexOf(sk) >= 0 && cast && (!knowsFn || knowsFn(sk))) {
                cast(sk, true);   // silent·免 MP
            }
        } catch (e) {}
    };
    // 相容舊呼叫名（handler 仍呼叫這些）
    const applySummonBoss = () => reSummonV2();
    const restoreSummonBoss = () => reSummonV2();   // cfg.on 已 false → 重召即還原原貌
    const clearAllSummons = () => reSummonV2();

    // ===== 1i-2. 🛡️ 召喚物不死（hook enemyAttackSummon(普攻) ＋ applyMobMagicToSummon(怪物魔法·v3.2.82)：全遊戲僅這兩處對召喚物 s.hp 扣血）=====
    const INVINC_KEY = 'geo_summon_invinc';
    const loadInvinc = () => { try { return JSON.parse(localStorage.getItem(INVINC_KEY)) || {}; } catch (e) { return {}; } };
    const saveInvinc = (o) => { try { localStorage.setItem(INVINC_KEY, JSON.stringify(o)); } catch (e) {} };
    (function hookEnemyAttackSummon() {
        const orig = _fn('enemyAttackSummon');
        if (!orig || window._summonInvincHooked) return;
        window.enemyAttackSummon = function (mob, s) {
            if (loadInvinc().on) { if (s) { if (s.mhp) s.hp = s.mhp; s._downed = false; } return; }   // 無敵：不受傷、不倒地
            return orig.call(this, mob, s);
        };
        window._summonInvincHooked = true;
    })();
    (function hookMobMagicToSummon() {
        const orig = _fn('applyMobMagicToSummon');
        if (!orig || window._summonInvincMagicHooked) return;
        window.applyMobMagicToSummon = function (mob, sk, s) {
            if (loadInvinc().on) { if (s) { if (s.mhp) s.hp = s.mhp; s._downed = false; } return; }   // 無敵：怪物魔法波及召喚物也不受傷
            return orig.call(this, mob, sk, s);
        };
        window._summonInvincMagicHooked = true;
    })();

    // ── hook 5：summonTick（迷魅怪 sk_charm 讀 hitBonus/interval）→ 套用命中+攻速強化（冪等·存 _base 避免疊乘）──
    (function hookSummonTickCharm() {
        const orig = _fn('summonTick');
        if (!orig || window._charmBuffHooked) return;
        window.summonTick = function (sm, clearFn, owner) {
            try {
                if (sm && sm.skId === 'sk_charm') {
                    if (sm._baseInterval == null) sm._baseInterval = sm.interval;
                    if (sm._baseHitBonus == null) sm._baseHitBonus = sm.hitBonus || 0;
                    const bf = loadSCBuff();
                    if (bf.on) {
                        sm.hitBonus = sm._baseHitBonus + (Number(bf.hitAdd) || 0);
                        sm.interval = Math.max(5, Math.round(sm._baseInterval * (Number(bf.aspdMult) || 1)));
                    } else {   // 關閉時還原原值
                        sm.hitBonus = sm._baseHitBonus;
                        sm.interval = sm._baseInterval;
                    }
                    // 🔮 繼承魔法：依旗標把怪本身的法術 proc 掛上/卸下（_magProc 由 manualCast 擷取）
                    if (isCharmMagicOn() && sm._magProc) {
                        if (!sm.proc) { sm.proc = sm._magProc; if (sm.proc.cdCur == null) sm.proc.cdCur = sm.proc.cd; }
                    } else if (sm.proc && sm.proc === sm._magProc) {
                        sm.proc = null;   // 關閉時卸下（迷魅原生 proc 恆 null·不會誤刪）
                    }
                }
            } catch (e) {}
            return orig.call(this, sm, clearFn, owner);
        };
        window._charmBuffHooked = true;
    })();

    if (loadSummonBoss().on) { console.log('[修改器] 召喚指定 BOSS（v2）已啟用'); reSummonV2(); }
    if (loadInvinc().on) { console.log('[修改器] 召喚物不死 已啟用'); }
    if (loadSCBuff().on) { console.log('[修改器] 召喚/迷魅 命中+攻速強化 已啟用'); }

    // ===== 2. 移除舊面板 =====
    let oldPanel = document.getElementById('geo-mod-panel');
    if (oldPanel) oldPanel.remove();

    // ===== 3. 外殼 =====
    let panel = document.createElement('div');
    panel.id = 'geo-mod-panel';
    panel.style.cssText = `
        position: fixed; top: 10px; right: 10px; width: 460px; max-height: 92vh;
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
        border: 3px solid #3b82f6; border-radius: 12px; z-index: 999999;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); color: #f8fafc;
        font-family: sans-serif; display: flex; flex-direction: column; overflow: hidden;`;

    // ===== 4. 道具分類下拉 =====
    let categorised = { "⚔️ 武器庫": [], "🛡️ 防具/盾牌": [], "💍 首飾/配件": [], "📜 卷軸/藥水/其他": [] };
    for (let id in DB.items) {
        let item = DB.items[id], type = item.type || '';
        if (type === 'wpn') categorised["⚔️ 武器庫"].push({ id, n: item.n });
        else if (type === 'arm') categorised["🛡️ 防具/盾牌"].push({ id, n: item.n });
        else if (type === 'acc') categorised["💍 首飾/配件"].push({ id, n: item.n });
        else categorised["📜 卷軸/藥水/其他"].push({ id, n: item.n });
    }
    let selectHtml = "";
    for (let cat in categorised) {
        selectHtml += `<optgroup label="${cat}" style="background:#0f172a; color:#94a3b8;">`;
        categorised[cat].forEach(i => { selectHtml += `<option value="${i.id}">${i.n} (${i.id})</option>`; });
        selectHtml += `</optgroup>`;
    }

    // 🔥 v3.0.77 屬性新制（代碼 fr/wa/wi/ea × 5階，名稱與遊戲 ATTR_AFFIX 一致）
    // key = 遊戲實際寫入 item.attr 的代碼；名稱為遊戲顯示名（tier1~5：傷害+1/3/5/7/9）
    const ATTR_MAP = {
        fr1:"火之", fr2:"爆炎", fr3:"火靈", fr4:"赤炎", fr5:"帕格里奧",
        wa1:"水之", wa2:"海嘯", wa3:"水靈", wa4:"霜凍", wa5:"伊娃",
        wi1:"風之", wi2:"暴風", wi3:"風靈", wi4:"蒼蘭", wi5:"沙哈",
        ea1:"地之", ea2:"崩裂", ea3:"地靈", ea4:"輝岩", ea5:"馬普勒"
    };
    // 元素 → 代碼字首（與遊戲 ATTR_ELE_PREFIX 一致）
    const ATTR_PREFIX = { fire: 'fr', water: 'wa', wind: 'wi', earth: 'ea' };

    // 六圍欄位定義（修正：補上「精神 WIS」，且改用 base+alloc+panacea 模型）
    const STATS = [
        { k: 'str', label: '力 STR', color: '#f87171' },
        { k: 'dex', label: '敏 DEX', color: '#34d399' },
        { k: 'con', label: '體 CON', color: '#fbbf24' },
        { k: 'int', label: '智 INT', color: '#60a5fa' },
        { k: 'wis', label: '精神 WIS', color: '#c084fc' },
        { k: 'cha', label: '魅 CHA', color: '#f472b6' }
    ];
    // 目前「有效值」= d 物件（顯示值）；改不到時退回 base+alloc+panacea
    const effStat = (k) => {
        if (player.d && typeof player.d[k] === 'number') return player.d[k];
        return (player.base?.[k] || 0) + (player.alloc?.[k] || 0) + (player.panacea?.[k] || 0);
    };
    let statInputs = STATS.map(s => `
        <div>${s.label}: <input type="number" id="mod-${s.k}" min="0" max="255"
            style="width:55px; background:#000; color:${s.color}; border:1px solid #475569; padding:2px;"
            value="${effStat(s.k)}"></div>`).join('');

    let attrOptions = '<option value="false" style="color:#fff;">無屬性</option>';
    [["fire","🔥"],["water","💧"],["earth","🪨"],["wind","⚡"]].forEach(([e, ic]) => {
        let pf = ATTR_PREFIX[e];
        for (let t = 5; t >= 1; t--) attrOptions += `<option value="${pf}${t}">${ic} ${ATTR_MAP[pf + t]}（${t}階）</option>`;
    });

    // 🔮 席琳套裝詞綴（seteff，40 種，8 組 × 5 件；組名＝前兩字）
    // 優先讀遊戲現有的 SHERINE_EFFECTS（隨遊戲更新自動同步），讀不到才用內建備份。
    const FALLBACK_SHERINE = [
        '紅獅的誓言','紅獅的壯志','紅獅的復仇','紅獅的熱情','紅獅的單思',
        '白鳥的誓言','白鳥的依戀','白鳥的夢想','白鳥的情愫','白鳥的犧牲',
        '鐵衛的誓言','鐵衛的象徵','鐵衛的盟約','鐵衛的奮戰','鐵衛的守護',
        '麗人的誓言','麗人的加護','麗人的期盼','麗人的依靠','麗人的單戀',
        '疾風的誓言','疾風的灑脫','疾風的傳說','疾風的襲擊','疾風的迅捷',
        '月光的誓言','月光的隱情','月光的幽蔽','月光的純潔','月光的消逝',
        '學徒的誓言','學徒的好奇','學徒的研究','學徒的夢想','學徒的智慧',
        '魔女的誓言','魔女的哀戚','魔女的束縛','魔女的瘋狂','魔女的冷冽'
    ];
    let SET_EFFECTS = (Array.isArray(G('SHERINE_EFFECTS')) && G('SHERINE_EFFECTS').length) ? G('SHERINE_EFFECTS') : FALLBACK_SHERINE;
    // 依組名(前兩字)分組做 optgroup
    let setGroups = {};
    SET_EFFECTS.forEach(name => { let g = name.slice(0, 2); (setGroups[g] = setGroups[g] || []).push(name); });
    let seteffOptions = '<option value="false" style="color:#fff;">無套裝詞綴</option>';
    for (let g in setGroups) {
        seteffOptions += `<optgroup label="✦ ${g}套裝" style="background:#052e16; color:#86efac;">`;
        setGroups[g].forEach(name => { seteffOptions += `<option value="${name}" style="color:#4ade80;">${name}</option>`; });
        seteffOptions += `</optgroup>`;
    }

    // ===== 已穿戴裝備：欄位定義、值轉換、選單建構 =====
    const SLOT_DEFS = [
        ['wpn','武器'],['offwpn','副手武器'],['helm','頭盔'],['armor','盔甲'],['shield','盾牌'],['cloak','斗篷'],
        ['tshirt','內衣'],['gloves','手套'],['boots','長靴'],['ring1','戒指1'],['ring2','戒指2'],
        ['ring3','戒指3'],['ring4','戒指4'],['amulet','項鍊'],['belt','腰帶'],['ear1','耳環1'],['ear2','耳環2'],['pet','寵物裝備'],['doll','魔法娃娃'],['arrow','箭矢']
    ];
    // 物品實際值 → 下拉 value
    const ancToVal = (a) => a === true ? 'true' : (['eternal','immortal','primordial'].includes(a) ? a : 'none');
    const blessToVal = (b) => b === true ? 'bless' : (b === 'cursed' ? 'cursed' : 'none');
    // 下拉 value → 物品實際值
    const valToAnc = (v) => v === 'true' ? true : (['eternal','immortal','primordial'].includes(v) ? v : false);
    const valToBless = (v) => v === 'bless' ? true : (v === 'cursed' ? 'cursed' : false);
    // 帶 selected 的選單建構：items = [[value, 標籤, 顏色]]
    const buildSel = (id, items, current, extra) => {
        let h = `<select id="${id}" style="background:#000; color:#fff; border:1px solid #475569; padding:1px; font-size:11px; ${extra || ''}">`;
        items.forEach(([v, label, color]) => {
            h += `<option value="${v}"${String(v) === String(current) ? ' selected' : ''} style="color:${color || '#fff'};">${label}</option>`;
        });
        return h + '</select>';
    };
    const TIER_ITEMS = [['none','一般','#fff'],['true','🔮遠古','#a855f7'],['eternal','💥永恆','#ef4444'],['immortal','🔱不朽','#22c55e'],['primordial','🌌太初','#3b82f6']];
    const STATUS_ITEMS = [['none','無','#fff'],['bless','✨祝福','#22c55e'],['cursed','💀詛咒','#ef4444']];
    let ATTR_ITEMS = [['false','無屬性','#fff']];
    [["fire","🔥"],["water","💧"],["earth","🪨"],["wind","⚡"]].forEach(([e, ic]) => { let pf = ATTR_PREFIX[e]; for (let t = 5; t >= 1; t--) ATTR_ITEMS.push([pf + t, ic + ATTR_MAP[pf + t] + '（' + t + '階）', '#60a5fa']); });
    let SETEFF_ITEMS = [['false','無套裝詞綴','#fff']];
    SET_EFFECTS.forEach(name => SETEFF_ITEMS.push([name, '✦' + name, '#4ade80']));
    // 🌟 屬性附加魔法（比照遊戲內建卷軸附加規則：需同元素 5 階屬性；技能池/基礎機率直接讀遊戲全域 ATTR_MAGIC_SKILLS，隨遊戲版本自動更新，不在修改器內另存一份）
    function attrMagicPoolForAttr(attrVal) {
        if (typeof ATTR_MAGIC_SKILLS === 'undefined' || typeof getAttrAffix !== 'function') return null;
        let aff = getAttrAffix(attrVal === 'false' ? false : attrVal);
        if (!aff || aff.tier !== 5) return null;
        return { ele: aff.ele, pool: ATTR_MAGIC_SKILLS[aff.ele] || [] };
    }
    function buildAttrMagicSelectHtml(id, attrVal, currentSkId) {
        let info = attrMagicPoolForAttr(attrVal);
        if (!info || !info.pool.length) {
            return `<select id="${id}" disabled style="background:#1e293b; color:#64748b; border:1px solid #475569; padding:1px; font-size:11px; width:172px;"><option>（需先設定同元素 5 階屬性）</option></select>`;
        }
        let h = `<select id="${id}" style="background:#000; color:#fde68a; border:1px solid #475569; padding:1px; font-size:11px; width:172px;"><option value="none">（無）</option>`;
        info.pool.forEach(p => {
            let nm = (typeof DB !== 'undefined' && DB.skills[p.skId] && DB.skills[p.skId].n) || p.skId;
            h += `<option value="${p.skId}"${p.skId === currentSkId ? ' selected' : ''}>${nm}（基礎${p.rate}%）</option>`;
        });
        return h + '</select>';
    }
    window.__geoModAttrMagicSyncGeneric = function (attrElId, wrapElId, magicSelId) {
        let attrEl = document.getElementById(attrElId);
        let host = document.getElementById(wrapElId);
        if (!attrEl || !host) return;
        host.innerHTML = buildAttrMagicSelectHtml(magicSelId, attrEl.value, null);
    };
    window.__geoModAttrMagicSync = function (slot) {
        window.__geoModAttrMagicSyncGeneric(`eq-${slot}-attr`, `eq-${slot}-attrmagic-wrap`, `eq-${slot}-attrmagic`);
    };

    // ===== 5. 面板內容 =====
    panel.innerHTML = `
        <div style="background:#1e3a8a; padding:12px; font-weight:bold; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #2563eb;">
            <span>🏰 放置天堂【精準相容管理面板 v3】<span style="font-size:11px; color:#93c5fd;"> 存檔位:${getSlot()}</span></span>
            <div style="display:flex; gap:6px;">
                <button onclick="document.getElementById('geo-mod-panel').style.display='none'; document.getElementById('geo-mod-fab').style.display='flex';" style="background:#475569; color:white; border:none; padding:2px 10px; border-radius:4px; cursor:pointer; font-weight:bold;" title="縮小成圖示">➖</button>
                <button onclick="document.getElementById('geo-mod-panel').remove(); let f=document.getElementById('geo-mod-fab'); if(f) f.remove();" style="background:#ef4444; color:white; border:none; padding:2px 8px; border-radius:4px; cursor:pointer;" title="關閉修改器">❌</button>
            </div>
        </div>

        <div id="geo-mod-tabbar" style="display:flex; gap:4px; padding:8px 10px; background:#0f172a; border-bottom:1px solid #334155; flex-wrap:wrap;">
            <button class="modtab-btn" data-tabbtn="stats" onclick="window.__geoModSwitchTab('stats')" style="flex:1; min-width:70px; background:#334155; color:#94a3b8; border:none; padding:6px 4px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">📊 數值/存檔</button>
            <button class="modtab-btn" data-tabbtn="mechanics" onclick="window.__geoModSwitchTab('mechanics')" style="flex:1; min-width:70px; background:#334155; color:#94a3b8; border:none; padding:6px 4px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">⚙️ 遊戲機制參數</button>
            <button class="modtab-btn" data-tabbtn="pets" onclick="window.__geoModSwitchTab('pets')" style="flex:1; min-width:70px; background:#334155; color:#94a3b8; border:none; padding:6px 4px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">🐾 寵物管理</button>
            <button class="modtab-btn" data-tabbtn="equip" onclick="window.__geoModSwitchTab('equip')" style="flex:1; min-width:70px; background:#334155; color:#94a3b8; border:none; padding:6px 4px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">🛠️ 裝備產生器</button>
            <button class="modtab-btn" data-tabbtn="skills" onclick="window.__geoModSwitchTab('skills')" style="flex:1; min-width:70px; background:#334155; color:#94a3b8; border:none; padding:6px 4px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">🎓 技能/背包</button>
        </div>

        <div style="padding:15px; flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:12px; font-size:13px;">

            <div class="modtab" data-tab="stats" style="display:flex; flex-direction:column; gap:12px;">

            <div style="font-weight:bold; color:#f59e0b;">📊 基礎數值（金幣 / 等級 / 經驗 / 點數）</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:rgba(0,0,0,0.2); padding:10px; border-radius:6px;">
                <div>金幣: <input type="number" id="mod-gold" style="width:80%; background:#000; color:#f59e0b; border:1px solid #475569; padding:2px;" value="${player.gold || 0}"></div>
                <div>等級: <input type="number" id="mod-lv" style="width:70%; background:#000; color:#10b981; border:1px solid #475569; padding:2px;" value="${player.lv || 1}"></div>
                <div>經驗: <input type="number" id="mod-exp" style="width:80%; background:#000; color:#93c5fd; border:1px solid #475569; padding:2px;" value="${player.exp || 0}"></div>
                <div>剩餘點數: <input type="number" id="mod-bonus" style="width:55%; background:#000; color:#facc15; border:1px solid #475569; padding:2px;" value="${player.bonus || 0}"></div>
            </div>

            <div style="font-weight:bold; color:#60a5fa;">🐉 龍之鑽石數量（跨角色共用貨幣・潘朵拉遺物市集）</div>
            <div style="background:rgba(96,165,250,0.08); border:1px solid #2563eb; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="font-size:12px;">數量:</span>
                    <input type="number" id="mod-diamonds" min="0" style="width:110px; background:#000; color:#93c5fd; text-align:center; border:1px solid #475569; padding:2px;" value="${getDiamonds()}">
                    <button id="btn-set-diamonds" style="flex:1; background:#2563eb; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🐉 設定數量</button>
                </div>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 此為同一套遊戲「所有角色共用」的貨幣（存在瀏覽器共用資料，不是存檔位），設定後立即生效，<b style="color:#f87171;">不需要</b>按下方「套用並存檔」也不需重整。<br>
                    ※ 若從未開啟過潘朵拉遺物市集，目前會顯示 0；設定後會自動建立共用資料，下次開啟市集時其餘欄位（布告欄/漂泊者等）會自動補齊。
                </div>
            </div>

            <div style="font-weight:bold; color:#a855f7;">🏪 黑市／遺物市集 上架刷新</div>
            <div style="background:rgba(168,85,247,0.08); border:1px solid #7c3aed; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <button id="btn-refresh-blackmarket" style="background:#7c3aed; color:#fff; border:none; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold;">🔄 強制刷新黑市商品（24件全換）</button>
                <button id="btn-reset-relicboards" style="background:#7c3aed; color:#fff; border:none; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold;">🔄 清除遺物布告欄冷卻（3欄全部可用）</button>
                <button id="btn-fulfill-relicboards" style="background:#059669; color:#fff; border:none; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold;">🎁 補齊布告欄兌換材料（缺什麼補什麼）</button>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 黑市刷新走玩家存檔（<code>player.pandoraMarket2</code>），立即生效，<b style="color:#f87171;">建議之後按「套用並存檔」固化</b>，否則沒存檔重整可能被下次自動輪換蓋掉。<br>
                    ※ 布告欄冷卻跟龍之鑽石一樣是跨角色共用資料，設定後立即生效、不需存檔重整；只清冷卻，不會動到欄位裡已存在的委託內容。<br>
                    ※ 「補齊兌換材料」會掃描目前 3 個布告欄裡進行中的委託，背包/倉庫缺哪樣兌換材料就直接補一份到背包（已經有的不會重複補），走遊戲本身的 gainItem() 直接生效，之後回遺物市集面板按「兌換」即可。
                </div>
            </div>

            <div style="font-weight:bold; color:#c084fc;">🧬 六圍屬性（改 alloc，需按下方「套用六圍」才會生效；新版超過 60 仍會提升能力）
                <button id="btn-all60" style="float:right; background:#7c3aed; color:#fff; border:none; padding:1px 8px; border-radius:4px; cursor:pointer; font-size:11px;">全部設 99</button>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; background:rgba(0,0,0,0.2); padding:10px; border-radius:6px;">
                ${statInputs}
            </div>
            <button id="btn-apply-stats" style="background:#9333ea; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🧬 套用六圍改動</button>
            <div style="font-size:11px; color:#64748b; margin-top:-4px;">※ 六圍數值只有按下這顆按鈕才會寫入角色，不會跟著上方「即時套用／套用並存檔」自動生效，避免切換角色時誤把舊數值帶進新角色。</div>
            <div style="display:flex; gap:6px; align-items:center; background:rgba(192,132,252,0.08); border:1px solid #9333ea; padding:8px; border-radius:6px;">
                <button id="btn-stat-break" style="flex:1; background:#7c3aed; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">💪 六圍突破80：<span id="stat-break-state">關閉</span></button>
                <span style="font-size:11px; color:#64748b;">80以上線性外推，越高越強</span>
            </div>

            </div>

            <div class="modtab" data-tab="mechanics" style="display:none; flex-direction:column; gap:12px;">

            <div style="font-weight:bold; color:#f59e0b;">⚡ 戰鬥節奏修改</div>
            <div style="background:rgba(245,158,11,0.08); border:1px solid #d97706; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:90px; font-size:12px;">攻擊間隔(秒):</span>
                    <input type="number" id="tempo-aspd" step="0.1" min="0.1" placeholder="不改" style="width:70px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">越小越快·下限0.1</span>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:90px; font-size:12px;">施法冷卻(tick):</span>
                    <input type="number" id="tempo-cast" step="1" min="0" placeholder="不改" style="width:70px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">0=無冷卻</span>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:90px; font-size:12px;">被擊硬直(tick):</span>
                    <input type="number" id="tempo-stun" step="1" min="0" placeholder="不改" style="width:70px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">0=免硬直</span>
                </div>
                <label style="display:flex; align-items:center; gap:4px; font-size:12px;">
                    <input type="checkbox" id="tempo-respawn"> 🐾 怪物立即重生（BOSS房/軍王之室不加速）
                </label>
                <div style="display:flex; gap:6px;">
                    <button id="btn-tempo-apply" style="flex:1; background:#d97706; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">⚡ 套用：<span id="tempo-state">關閉</span></button>
                    <button id="btn-tempo-preset" style="flex:1; background:#b45309; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🚀 一鍵極速</button>
                </div>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 留空＝不改該項。全部有引擎保底，設合理極限不會出錯。<br>
                    ※ 每次進遊戲後須再執行修改器，此設定才會持續生效。
                </div>
            </div>

            <div style="font-weight:bold; color:#38bdf8;">🤝 傭兵上限修改</div>
            <div style="background:rgba(56,189,248,0.08); border:1px solid #0284c7; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:110px; font-size:12px;">同時上場人數:</span>
                    <input type="number" id="ally-cap" min="1" max="99" placeholder="預設3" style="width:60px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <button id="btn-ally-cap" style="flex:1; background:#0284c7; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🤝 套用：<span id="ally-cap-state">關閉</span></button>
                </div>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 遊戲原本上限 3 名。設更高可同時帶更多傭兵。<br>
                    ※ 每次進遊戲後須再執行修改器才會持續生效。
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:6px; background:rgba(168,85,247,0.08); border:1px solid #9333ea; padding:8px; border-radius:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <button id="btn-charm-boss" style="flex:1; background:#9333ea; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">💜 迷魅術可迷魅BOSS：<span id="charm-boss-state">關閉</span></button>
                    <span style="font-size:11px; color:#64748b;">BOSS也能100%迷魅成你的召喚物</span>
                </div>
                <button id="btn-charm-magic" style="background:#7c3aed; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🔮 迷魅怪繼承魔法：<span id="charm-magic-state">關閉</span></button>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 開啟後，被迷魅的怪會用「自己最強的傷害型魔法」攻擊敵人（只吃傷害型·中毒/石化等狀態型不繼承）。<br>
                    ※ <b>需重新迷魅一次</b>才會擷取該怪法術；之後可隨時開關。每次進遊戲須重跑修改器。
                </div>
            </div>

            <div style="font-weight:bold; color:#f472b6;">🐉 召喚指定 BOSS（召喚術 / 強力屬性精靈）</div>
            <div style="background:rgba(244,114,182,0.08); border:1px solid #db2777; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="font-size:12px;">BOSS:</span>
                    <select id="summon-boss-sel" style="flex:1; background:#000; color:#fde68a; padding:3px; border:1px solid #475569; font-size:12px;"></select>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="font-size:12px;">傷害倍率:</span>
                    <input type="number" id="summon-boss-mult" value="1" step="0.5" min="0.1" style="width:60px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">×BOSS數值（1=原數值）</span>
                </div>
                <button id="btn-summon-boss" style="background:#db2777; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🐉 套用：<span id="summon-boss-state">關閉</span></button>
                <button id="btn-summon-invinc" style="background:#0d9488; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🛡️ 召喚物不死：<span id="summon-invinc-state">關閉</span></button>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 召喚術／強力屬性精靈（僅玩家）召出的召喚物，傷害/攻速/屬性/<b>血量</b>換成選定 BOSS（傷害換算成 v2 尺度·血量用該 BOSS 真實血量）。<br>
                    ※ 開/關會自動重召目前召喚物立即生效；強力精靈進 BOSS 模式時精靈王全體法術不觸發。<br>
                    ※ 🛡️不死＝召喚物完全免傷、不會倒地。每次進遊戲須重跑修改器。
                </div>
            </div>

            <div style="font-weight:bold; color:#22d3ee;">⚡ 召喚 / 迷魅 命中 + 攻速強化</div>
            <div style="background:rgba(34,211,238,0.08); border:1px solid #0891b2; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:88px; font-size:12px;">命中加成:</span>
                    <input type="number" id="sc-buff-hit" value="20" step="5" style="width:60px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">+命中（越高越易命中）</span>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:88px; font-size:12px;">攻速倍率:</span>
                    <input type="number" id="sc-buff-aspd" value="0.5" step="0.1" min="0.1" max="1" style="width:60px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">越小越快（1=原速·0.5=兩倍速）</span>
                </div>
                <button id="btn-sc-buff" style="background:#0891b2; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">⚡ 套用：<span id="sc-buff-state">關閉</span></button>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 同時作用於召喚術／造屍術／屬性精靈（v2）與迷魅怪。與 BOSS/不死 可同時開。<br>
                    ※ 迷魅怪命中原本上限 20（仍有 5% 天生失手·擲 1 必失手）；召喚無此上限。<br>
                    ※ 每次進遊戲須重跑修改器。
                </div>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; background:rgba(0,0,0,0.2); padding:10px; border-radius:6px;">
                <button id="btn-fill-hpmp" style="flex:1; background:#16a34a; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">補滿 HP/MP</button>
                <button id="btn-consolidate" style="flex:1; background:#0891b2; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">整理背包</button>
                <button id="btn-clear-inv" style="flex:1; background:#b91c1c; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">清空背包</button>
                <button id="btn-give-proof" style="flex:1; background:#1d4ed8; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">🏅 給精通之證</button>
            </div>

            </div>

            <div class="modtab" data-tab="skills" style="display:none; flex-direction:column; gap:12px;">

            <div style="font-weight:bold; color:#f472b6;">🎓 職業技能<span id="mod-cls-info" style="font-size:11px; color:#94a3b8; font-weight:normal;"></span></div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; background:rgba(0,0,0,0.2); padding:10px; border-radius:6px;">
                <button id="btn-learn-class" style="flex:1; background:#db2777; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">學會本職全部技能</button>
                <button id="btn-learn-all" style="flex:1; background:#9333ea; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">學會全部技能</button>
                <button id="btn-clear-skills" style="flex:1; background:#b91c1c; color:#fff; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">清空已學</button>
            </div>
            <div style="display:flex; gap:6px; align-items:center; background:rgba(16,185,129,0.08); border:1px solid #059669; padding:8px; border-radius:6px;">
                <button id="btn-elf-allele" style="flex:1; background:#059669; color:#fff; border:none; padding:7px; border-radius:4px; cursor:pointer; font-weight:bold;">🧝 妖精全屬性魔法：<span id="elf-allele-state">關閉</span></button>
                <span style="font-size:11px; color:#64748b;">解除「一生一屬性」限制（等級/MP照舊）</span>
            </div>

            <div style="font-weight:bold; color:#a78bfa;">🔮 自創攻擊魔法（新增後出現在「攻擊技能」自動施放下拉選單）</div>
            <div style="background:rgba(167,139,250,0.08); border:1px solid #7c3aed; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:76px; font-size:12px;">技能名稱:</span>
                    <input type="text" id="csk-name" placeholder="例如：熔岩爆裂術" style="flex:1; background:#000; color:#fff; padding:3px 6px; border:1px solid #475569; font-size:12px;">
                </div>
                <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                    <span style="width:76px; font-size:12px;">MP消耗:</span>
                    <input type="number" id="csk-mp" value="20" min="0" style="width:56px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                    <span style="font-size:12px;">法術階級:</span>
                    <input type="number" id="csk-tier" value="5" min="1" max="10" title="影響傷害係數 ×(1+階級/10)，也決定迴響精通觸發率" style="width:48px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;">
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:76px; font-size:12px;">傷害骰數:</span>
                    <input type="number" id="csk-dice-n" value="3" min="1" style="width:48px; background:#000; color:#fca5a5; text-align:center; border:1px solid #475569;"> D
                    <input type="number" id="csk-dice-s" value="10" min="1" style="width:48px; background:#000; color:#fca5a5; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">（骰完再套統一魔法公式與屬性剋制，不是最終傷害）</span>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:76px; font-size:12px;">傷害屬性:</span>
                    <select id="csk-ele" style="flex:1; background:#000; color:#3b82f6; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="none">無屬性</option><option value="fire">火</option><option value="water">水</option><option value="wind">風</option><option value="earth">地</option>
                    </select>
                    <span style="width:60px; font-size:12px;">範圍:</span>
                    <select id="csk-target" style="width:90px; background:#000; color:#4ade80; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="">單體</option><option value="all">全體（場上全部敵人）</option>
                    </select>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:76px; font-size:12px;">動畫效果:</span>
                    <select id="csk-anim" style="flex:1; background:#000; color:#facc15; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="">無（不播放施法動畫，安全但沒特效）</option>
                        ${(typeof SPELL_FX !== 'undefined' ? Object.keys(SPELL_FX) : []).sort().map(k => `<option value="${k}">沿用「${k}」</option>`).join('')}
                    </select>
                </div>
                <div style="font-size:10px; color:#64748b;">※ 自訂技能名稱不在遊戲的特效登記表裡，不選這項的話施放時只是不會有動畫（安全）；瀏覽器 console 出現一堆「Failed to load resource」通常是有其他地方誤把技能名稱當成圖片路徑，跟這裡選不選無關，選這裡是直接借用一個真實存在的動畫。</div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:76px; font-size:12px;">異常效果:</span>
                    <select id="csk-status-kind" style="flex:1; background:#000; color:#f472b6; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="">無</option>
                        <option value="freeze">冰凍</option><option value="stun">暈眩</option><option value="stone">石化</option><option value="sleep">沉睡</option>
                        <option value="slow">緩速</option><option value="blind">目盲</option><option value="weaken">弱化</option><option value="confuse">混亂</option>
                        <option value="panic">恐慌</option><option value="mrhalf">魔抗減半</option><option value="magicseal">魔法封印</option><option value="armorbreak">破甲</option>
                        <option value="fragile">脆弱</option><option value="disease">疾病</option><option value="vacuum">真空</option><option value="broken">損壞</option>
                        <option value="guardbreak">護衛毀滅</option><option value="terror">恐懼</option><option value="doom">死神</option><option value="muddywater">污濁</option>
                    </select>
                    <span style="font-size:12px;">秒:</span>
                    <input type="number" id="csk-status-dur" value="6" min="1" style="width:48px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px; color:#f87171;"><input type="checkbox" id="csk-lifesteal"> 吸血（造成的傷害全額轉成自己HP）</label>
                </div>
                <button id="btn-csk-create" style="background:#7c3aed; color:#fff; border:none; padding:8px; border-radius:4px; cursor:pointer; font-weight:bold;">🔮 新增並學會這個魔法</button>
                <div style="font-size:10px; color:#64748b; line-height:1.5;">
                    ※ 自訂技能定義會另外存一份在瀏覽器（跟存檔位無關、全角色共用），每次重新整理網頁後<b style="color:#f87171;">仍需重跑一次修改器</b>才會自動還原註冊，但不用重新填表單、也不用重按這顆按鈕。<br>
                    ※ 新增後如果沒馬上出現在「攻擊技能」下拉，切一下分頁面板（例如裝備分頁再切回）即可刷新選單。
                </div>
                <div style="border-top:1px dashed #7c3aed; margin-top:4px; padding-top:8px; display:flex; gap:6px; align-items:center;">
                    <span style="width:76px; font-size:12px;">刪除自訂:</span>
                    <select id="csk-del-sel" style="flex:1; background:#000; color:#fca5a5; padding:3px; border:1px solid #475569; font-size:12px;"><option value="">（沒有自訂魔法）</option></select>
                    <button id="btn-csk-delete" style="background:#7f1d1d; color:#fca5a5; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">🗑️ 刪除</button>
                </div>
            </div>

            </div>

            <div class="modtab" data-tab="pets" style="display:none; flex-direction:column; gap:12px;">

            <div style="font-weight:bold; color:#fbbf24;">🐾 寵物管理（種類 / 個別裝備即時修改）</div>
            <div style="background:rgba(251,191,36,0.08); border:1px solid #d97706; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:70px; font-size:12px;">選擇寵物:</span>
                    <select id="pet-sel" style="flex:1; background:#000; color:#fde68a; padding:3px; border:1px solid #475569; font-size:12px;"></select>
                    <button id="btn-pet-refresh" title="重新整理清單" style="background:#475569; color:#fff; border:none; padding:5px 8px; border-radius:4px; cursor:pointer; font-size:12px;">🔄</button>
                </div>
                <div id="pet-info" style="font-size:11px; color:#94a3b8; line-height:1.5;">（尚未選擇寵物）</div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:70px; font-size:12px;">變更種類:</span>
                    <select id="pet-form-sel" style="flex:1; background:#000; color:#a7f3d0; padding:3px; border:1px solid #475569; font-size:12px;"></select>
                    <button id="btn-pet-form" style="background:#059669; color:#fff; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">變更</button>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:70px; font-size:12px;">寵物武器:</span>
                    <select id="pet-wpn-sel" style="flex:1; background:#000; color:#fca5a5; padding:3px; border:1px solid #475569; font-size:12px;"></select>
                    <input type="number" id="pet-wpn-en" value="0" min="0" max="9" title="強化值" style="width:42px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                    <button id="btn-pet-wpn" style="background:#dc2626; color:#fff; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">裝備</button>
                    <button id="btn-pet-wpn-off" style="background:#7f1d1d; color:#fca5a5; border:none; padding:6px 8px; border-radius:4px; cursor:pointer; font-size:11px;">卸下</button>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <span style="width:70px; font-size:12px;">寵物防具:</span>
                    <select id="pet-arm-sel" style="flex:1; background:#000; color:#93c5fd; padding:3px; border:1px solid #475569; font-size:12px;"></select>
                    <input type="number" id="pet-arm-en" value="0" min="0" max="9" title="強化值" style="width:42px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                    <button id="btn-pet-arm" style="background:#2563eb; color:#fff; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;">裝備</button>
                    <button id="btn-pet-arm-off" style="background:#7f1d1d; color:#fca5a5; border:none; padding:6px 8px; border-radius:4px; cursor:pointer; font-size:11px;">卸下</button>
                </div>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 清單含「寵物保管」與「出戰中」的全部寵物（含其他角色的·帳號內同模式全角色共通）。<br>
                    ※ 「變更種類」保留等級/經驗，並依新種類重新換算血量/魔力上限（其餘同等級玩家一律套用）。<br>
                    ※ 裝備下拉列出此版本全部「寵物武器／寵物防具」道具，直接指定即可，不消耗背包物品、不影響其原有祝福/屬性附魔。<br>
                    ※ 每項操作皆直接寫入共用寵物保管資料並立即生效，<b style="color:#f87171;">不需要</b>按下方「套用並存檔」，但仍需其他分頁/角色重新整理才會看到最新狀態。
                </div>
            </div>

            </div>

            <div class="modtab" data-tab="equip" style="display:none; flex-direction:column; gap:12px;">

            <div style="font-weight:bold; color:#4ade80;">🧿 已穿戴裝備詞綴即時修改
                <button id="btn-apply-eq" style="float:right; background:#16a34a; color:#fff; border:none; padding:1px 10px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;">套用穿戴改動</button>
            </div>
            <div id="mod-eq-container" style="background:#020617; border:1px solid #166534; border-radius:6px; min-height:60px; max-height:260px; overflow-y:auto; padding:6px; display:flex; flex-direction:column; gap:6px; flex-shrink:0;"></div>

            <div style="font-weight:bold; color:#3b82f6;">⚔️ 100% 相容道具產生器</div>
            <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div>🔍 搜尋: <input type="text" id="add-search" placeholder="輸入物品名稱或ID關鍵字…" style="width:73%; background:#000; color:#fde68a; padding:3px; border:1px solid #b45309;"></div>
                <div>選道具: <select id="add-id" style="width:75%; background:#000; color:white; padding:2px; border:1px solid #475569;">${selectHtml}</select> <span id="add-count" style="font-size:11px; color:#64748b;"></span></div>
                <div>階級:
                    <select id="add-tier" style="width:33%; background:#000; color:#ec4899; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="none" style="color:#fff;">一般裝備</option>
                        <option value="true" style="color:#a855f7;">🔮 遠古</option>
                        <option value="eternal" style="color:#ef4444;">💥 永恆</option>
                        <option value="immortal" style="color:#22c55e;">🔱 不朽</option>
                        <option value="primordial" style="color:#3b82f6;">🌌 太初</option>
                    </select>
                    狀態:
                    <select id="add-status" style="width:33%; background:#000; color:#22c55e; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="none" style="color:#fff;">無狀態</option>
                        <option value="bless" style="color:#22c55e;">✨ 祝福的</option>
                        <option value="cursed" style="color:#ef4444;">💀 詛咒的</option>
                    </select>
                </div>
                <div>強化 +: <input type="number" id="add-en" value="0" style="width:45px; background:#000; text-align:center; border:1px solid #475569;">
                     數量: <input type="number" id="add-cnt" value="1" style="width:50px; background:#000; text-align:center; border:1px solid #475569;">
                     <label style="font-size:11px; color:#94a3b8;"><input type="checkbox" id="add-lock"> 鎖定</label>
                </div>
                <div>屬性: <select id="add-attr" onchange="window.__geoModAttrMagicSyncGeneric('add-attr','add-attrmagic-wrap','add-attrmagic')" style="width:75%; background:#000; color:#3b82f6; padding:2px; border:1px solid #475569; font-weight:bold;">${attrOptions}</select></div>
                <div>🌟屬性附加魔法: <span id="add-attrmagic-wrap">${buildAttrMagicSelectHtml('add-attrmagic', 'false', null)}</span>
                    星級: <select id="add-attrmagicstar" style="width:60px; background:#000; color:#facc15; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="1">★1</option><option value="2">★★2</option><option value="3">★★★3</option>
                    </select>
                </div>
                <div style="font-size:10px; color:#64748b;">※ 需先把上面「屬性」選到同元素 5 階，這裡才會列出可選技能（跟遊戲內建卷軸附加規則一致）。</div>
                <div>套裝詞綴: <select id="add-seteff" style="width:72%; background:#000; color:#4ade80; padding:2px; border:1px solid #166534; font-weight:bold;">${seteffOptions}</select></div>
                <div style="font-size:11px; color:#64748b;">※ 套裝詞綴只在「武器/頭盔/盔甲/手套/長靴/斗篷/腰帶」且已裝備時才計入套裝加成。</div>
                <button id="btn-add-item" style="background:#2563eb; color:white; border:none; padding:6px; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:4px;">⚡ 生成並放入背包</button>
            </div>

            <div style="font-weight:bold; color:#e879f9;">🔮 自訂魔法武器產生器（特效隨強化提升）</div>
            <div style="background:rgba(168,85,247,0.08); border:1px solid #9333ea; padding:10px; border-radius:6px; display:flex; flex-direction:column; gap:6px;">
                <div>武器名稱: <input type="text" id="cw-name" value="我的魔法弓" maxlength="12" style="width:60%; background:#000; color:#fde68a; padding:2px; border:1px solid #475569;"></div>
                <div>武器型態<span style="font-size:11px; color:#64748b;">（分類與裝備收集冊一致）</span>:
                    <select id="cw-base" style="width:60%; background:#000; color:#fde68a; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="dagger">🔪 匕首</option>
                        <option value="sword1">🗡 單手劍</option>
                        <option value="sword2">⚔ 雙手劍</option>
                        <option value="katana">🪒 武士刀</option>
                        <option value="blunt1">🔨 單手鈍器</option>
                        <option value="blunt2">🔨 雙手鈍器</option>
                        <option value="spear">🔱 矛</option>
                        <option value="claw">🐾 鋼爪</option>
                        <option value="dual">⚔ 雙刀</option>
                        <option value="chainsword">⛓ 鎖鏈劍</option>
                        <option value="bow" selected>🏹 弓（遠程）</option>
                        <option value="xbow">🎯 十字弓（遠程）</option>
                        <option value="wand">🪄 魔杖（法師/施法）</option>
                        <option value="qigu">👻 奇古獸（幻術士專屬）</option>
                        <option value="wpn_other">❓ 其他武器</option>
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    圖示（借用現有武器）:
                    <img id="cw-icon-preview" src="" style="width:28px; height:28px; object-fit:contain; background:#1e293b; border:1px solid #475569; border-radius:4px;" onerror="this.style.opacity=0.3">
                    <select id="cw-icon" style="flex:1; background:#000; color:#fde68a; padding:2px; border:1px solid #475569;"></select>
                    <label style="font-size:11px; color:#64748b; white-space:nowrap;"><input type="checkbox" id="cw-icon-all"> 顯示全部</label>
                </div>
                <div>特效名稱: <input type="text" id="cw-skn" value="星辰爆" maxlength="8" style="width:40%; background:#000; color:#fde68a; padding:2px; border:1px solid #475569;">
                    屬性:
                    <select id="cw-ele" style="width:28%; background:#000; color:#60a5fa; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="none">⚪ 無屬性</option>
                        <option value="fire">🔥 火</option>
                        <option value="water">💧 水</option>
                        <option value="earth">🪨 地</option>
                        <option value="wind" selected>⚡ 風</option>
                    </select>
                </div>
                <div>基礎傷害（覆寫型態預設）:
                    小型 <input type="number" id="cw-dmgs" placeholder="自動" min="0" style="width:50px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                    大型 <input type="number" id="cw-dmgl" placeholder="自動" min="0" style="width:50px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">（留空＝用型態預設）</span>
                </div>
                <div>特效傷害模式:
                    <select id="cw-dmgmode" style="background:#000; color:#fde68a; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="dice" selected>🎲 骰子（×強化倍率）</option>
                        <option value="fixed">🔢 固定數值</option>
                    </select>
                </div>
                <div id="cw-dice-row">特效傷害骰子:
                    <input type="number" id="cw-dicen" value="10" min="1" style="width:42px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"> D
                    <input type="number" id="cw-dicef" value="20" min="1" style="width:48px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">（如 10D20）</span>
                </div>
                <div id="cw-fixed-row" style="display:none;">特效固定傷害:
                    <input type="number" id="cw-fixeddmg" value="500" min="1" style="width:70px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                    <span style="font-size:11px; color:#64748b;">（每次特效固定此值，仍×強化倍率與魔攻）</span>
                </div>
                <div style="border-top:1px dashed #475569; padding-top:6px; display:flex; flex-direction:column; gap:4px;">
                    <div style="color:#a78bfa; font-weight:bold; font-size:12px;">✨ 特效發動設定</div>
                    <label style="display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="cw-aoe"> 🌐 攻擊全體：特效對敵方全體施放（同地獄火）
                    </label>
                    <div>發動機率模式:
                        <select id="cw-procmode" style="background:#000; color:#fde68a; padding:2px; border:1px solid #475569; font-weight:bold;">
                            <option value="scale" selected>📈 隨強化（1%+強化×1%）</option>
                            <option value="fixed">🔒 固定機率</option>
                        </select>
                    </div>
                    <div id="cw-procfixed-row" style="display:none;">固定發動機率:
                        <input type="number" id="cw-procfixed" value="100" min="1" max="100" style="width:50px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">%
                        <span style="font-size:11px; color:#64748b;">（不隨強化變，例如 100% 必定發動）</span>
                    </div>
                </div>
                <div style="border-top:1px dashed #475569; padding-top:6px; display:flex; flex-direction:column; gap:4px;">
                    <div style="color:#f87171; font-weight:bold; font-size:12px;">🩸 吸血 / 吸魔（引擎原生特性）</div>
                    <label style="display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="cw-vamp"> 吸血：一般攻擊吸取傷害
                        <input type="number" id="cw-vamp-pct" value="5" min="1" max="100" style="width:46px; background:#000; color:#fca5a5; text-align:center; border:1px solid #475569;">% 為 HP
                    </label>
                    <label style="display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="cw-mponhit"> 吸魔：命中恢復 MP
                        <span style="font-size:11px; color:#64748b;">（量＝1+max(0,強化-6)，引擎固定）</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="cw-spheal"> 特效吸血：施放特效時回
                        <input type="number" id="cw-spheal-pct" value="20" min="1" max="100" style="width:46px; background:#000; color:#fca5a5; text-align:center; border:1px solid #475569;">% 特效傷害為 HP
                    </label>
                    <span style="font-size:11px; color:#64748b;">※ 特效吸血需有上方特效骰子才有意義。</span>
                </div>
                <div style="border-top:1px dashed #475569; padding-top:6px; display:flex; flex-direction:column; gap:4px;">
                    <div style="color:#34d399; font-weight:bold; font-size:12px;">📊 六圍被動加成（引擎原生欄位·留空/0＝不加）</div>
                    <div style="display:flex; gap:4px; flex-wrap:wrap;">
                        <span>力量<input type="number" id="cw-str" value="0" style="width:38px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                        <span>敏捷<input type="number" id="cw-dex" value="0" style="width:38px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                        <span>體質<input type="number" id="cw-con" value="0" style="width:38px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                        <span>智力<input type="number" id="cw-int" value="0" style="width:38px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                        <span>精神<input type="number" id="cw-wis" value="0" style="width:38px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                        <span>魅力<input type="number" id="cw-cha" value="0" style="width:38px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                    </div>
                </div>
                <div style="border-top:1px dashed #475569; padding-top:6px; display:flex; flex-direction:column; gap:4px;">
                    <div style="color:#fb923c; font-weight:bold; font-size:12px;">👹 裝備時變身（比照真．冥皇執行劍裝備變身死亡騎士的機制）</div>
                    <select id="cw-morph" style="background:#000; color:#fde68a; padding:2px; border:1px solid #475569;">
                        <option value="" selected>（無變身）</option>
                    </select>
                    <span style="font-size:11px; color:#64748b;">※ 只變速度型態（攻速/走速/施法/暈眩抗性）與外觀，不額外加傷害；優先序低於套裝變身，卸下即消失。</span>
                </div>
                <div>職業限制:
                    <select id="cw-req" style="width:45%; background:#000; color:#93c5fd; padding:2px; border:1px solid #475569;">
                        <option value="all" selected>全職業</option>
                        <option value="knight">騎士</option>
                        <option value="mage">法師</option>
                        <option value="elf">妖精</option>
                        <option value="dark">黑暗妖精</option>
                        <option value="illusion">幻術士</option>
                        <option value="dragon">龍騎士</option>
                        <option value="warrior">狂戰士</option>
                        <option value="royal">王族</option>
                    </select>
                    強化+: <input type="number" id="cw-en" value="9" min="0" style="width:45px; background:#000; text-align:center; border:1px solid #475569;">
                </div>
                <div style="font-size:11px; color:#a78bfa; line-height:1.5;">
                    📊 預估：發動率 <span id="cw-preview-rate" style="color:#fde68a;">10%</span>　·　特效傷害倍率 <span id="cw-preview-dmg" style="color:#fde68a;">×1.9</span>（未計魔攻加成）
                </div>
                <button id="btn-add-cw" style="background:#9333ea; color:white; border:none; padding:6px; border-radius:4px; font-weight:bold; cursor:pointer; margin-top:2px;">🔮 鍛造並放入背包</button>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 圖示為借用現有武器的圖檔（自訂名字沒有對應圖檔會 404），不影響武器本身數值/特效。<br>
                    ※ 規格存於瀏覽器（localStorage），<b style="color:#f87171;">每次進遊戲後須再執行一次本修改器</b>，自訂武器才會生效（會自動重新注入）。<br>
                    ※ 發動率 = 1% + 強化×1%；特效傷害 = 骰子 ×(1+強化/10)，再受魔法傷害加成與屬性剋制。
                </div>
                <button id="btn-clear-cw" style="background:#7f1d1d; color:#fca5a5; border:none; padding:4px; border-radius:4px; font-size:11px; cursor:pointer;">🗑 清除所有自訂武器規格</button>
                <div style="border-top:1px solid #475569; margin-top:6px; padding-top:8px;">
                    <div style="color:#e879f9; font-weight:bold; font-size:12px; margin-bottom:4px;">📋 已創建的自訂武器（可編輯 / 刪除 / 再鍛造新的一把）</div>
                    <div id="cw-list" style="display:flex; flex-direction:column; gap:4px; max-height:220px; overflow-y:auto;"></div>
                </div>
            </div>

            <div style="background:rgba(45,212,191,0.06); border:1px solid #0d9488; border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px;">
                <div style="font-weight:bold; color:#5eead4;">🛡️ 自訂防具/飾品產生器</div>
                <div>名稱: <input type="text" id="ca-name" placeholder="我的防具" style="width:60%; background:#000; color:#fff; padding:2px; border:1px solid #475569;"></div>
                <div>部位:
                    <select id="ca-slot" style="background:#000; color:#fde68a; padding:2px; border:1px solid #475569; font-weight:bold;">
                        <option value="helm" selected>頭盔</option>
                        <option value="armor">盔甲</option>
                        <option value="cloak">斗篷</option>
                        <option value="gloves">手套</option>
                        <option value="boots">長靴</option>
                        <option value="belt">腰帶</option>
                        <option value="shin">護脛</option>
                        <option value="tshirt">內衣</option>
                        <option value="shield">盾牌</option>
                        <option value="ring">戒指（飾品）</option>
                        <option value="amulet">項鍊（飾品）</option>
                        <option value="ear">耳環（飾品）</option>
                    </select>
                    職業限制:
                    <select id="ca-req" style="background:#000; color:#93c5fd; padding:2px; border:1px solid #475569;">
                        <option value="all" selected>全職業</option>
                        <option value="knight">騎士</option>
                        <option value="mage">法師</option>
                        <option value="elf">妖精</option>
                        <option value="dark">黑暗妖精</option>
                        <option value="illusion">幻術士</option>
                        <option value="dragon">龍騎士</option>
                        <option value="warrior">狂戰士</option>
                        <option value="royal">王族</option>
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    圖示（借用現有防具/飾品）:
                    <img id="ca-icon-preview" src="" style="width:28px; height:28px; object-fit:contain; background:#1e293b; border:1px solid #475569; border-radius:4px;" onerror="this.style.opacity=0.3">
                    <select id="ca-icon" style="flex:1; background:#000; color:#fde68a; padding:2px; border:1px solid #475569;"></select>
                    <label style="font-size:11px; color:#64748b; white-space:nowrap;"><input type="checkbox" id="ca-icon-all"> 顯示全部</label>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <span>防禦(AC)<input type="number" id="ca-ac" value="5" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                    <span>HP<input type="number" id="ca-mhp" value="0" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                    <span>MP<input type="number" id="ca-mmp" value="0" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                    <span>HP恢復<input type="number" id="ca-hpr" value="0" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                    <span>MP恢復<input type="number" id="ca-mpr" value="0" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                    <span title="魔法抵抗">MR<input type="number" id="ca-mr" value="0" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                    <span title="迴避率">ER<input type="number" id="ca-er" value="0" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                    <span title="固定傷害減免">DR<input type="number" id="ca-dr" value="0" style="width:44px; background:#000; color:#fff; text-align:center; border:1px solid #475569;"></span>
                </div>
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <span style="color:#94a3b8; font-size:11px; align-self:center;">屬性抗性:</span>
                    <span>火<input type="number" id="ca-resfire" value="0" style="width:38px; background:#000; color:#fca5a5; text-align:center; border:1px solid #475569;"></span>
                    <span>水<input type="number" id="ca-reswater" value="0" style="width:38px; background:#000; color:#93c5fd; text-align:center; border:1px solid #475569;"></span>
                    <span>風<input type="number" id="ca-reswind" value="0" style="width:38px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                    <span>地<input type="number" id="ca-researth" value="0" style="width:38px; background:#000; color:#fde68a; text-align:center; border:1px solid #475569;"></span>
                </div>
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <span style="color:#34d399; font-size:11px; align-self:center;">六圍加成:</span>
                    <span>力<input type="number" id="ca-str" value="0" style="width:36px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                    <span>敏<input type="number" id="ca-dex" value="0" style="width:36px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                    <span>體<input type="number" id="ca-con" value="0" style="width:36px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                    <span>智<input type="number" id="ca-int" value="0" style="width:36px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                    <span>精<input type="number" id="ca-wis" value="0" style="width:36px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                    <span>魅<input type="number" id="ca-cha" value="0" style="width:36px; background:#000; color:#a7f3d0; text-align:center; border:1px solid #475569;"></span>
                </div>
                <div>強化+: <input type="number" id="ca-en" value="9" min="0" style="width:45px; background:#000; text-align:center; border:1px solid #475569;"></div>
                <button id="btn-add-ca" style="background:#0d9488; color:white; border:none; padding:6px; border-radius:4px; font-weight:bold; cursor:pointer;">🛡️ 打造並放入背包</button>
                <div style="font-size:11px; color:#64748b; line-height:1.5;">
                    ※ 圖示為借用現有防具/飾品的圖檔，不影響數值。留 0 的欄位不會加上該效果。<br>
                    ※ 規格存於瀏覽器（localStorage），<b style="color:#f87171;">每次進遊戲後須再執行一次本修改器</b>，才會重新生效。
                </div>
                <button id="btn-clear-ca" style="background:#7f1d1d; color:#fca5a5; border:none; padding:4px; border-radius:4px; font-size:11px; cursor:pointer;">🗑 清除所有自訂防具/飾品規格</button>
                <div style="border-top:1px solid #475569; margin-top:6px; padding-top:8px;">
                    <div style="color:#5eead4; font-weight:bold; font-size:12px; margin-bottom:4px;">📋 已創建的自訂防具/飾品（可編輯 / 刪除 / 再打造新的一把）</div>
                    <div id="ca-list" style="display:flex; flex-direction:column; gap:4px; max-height:220px; overflow-y:auto;"></div>
                </div>
            </div>

            </div>

            <div class="modtab" data-tab="skills" style="display:none; flex-direction:column; gap:12px;">

            <div style="font-weight:bold; color:#94a3b8;">🎒 目前背包內容（<span id="mod-inv-count">0</span>）</div>
            <div id="mod-inv-container" style="background:#020617; border:1px solid #334155; border-radius:6px; min-height:120px; max-height:240px; overflow-y:auto; padding:6px; display:flex; flex-direction:column; gap:4px; flex-shrink:0;"></div>

            </div>

        </div>

        <div style="padding:10px; background:#1e293b; border-top:1px solid #334155; display:flex; gap:8px;">
            <button id="btn-apply-live" style="flex:1; background:#0ea5e9; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; cursor:pointer;">⚡ 即時套用<br><span style="font-size:10px;">(不重整)</span></button>
            <button id="btn-save-all" style="flex:1.4; background:#10b981; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; font-size:14px; cursor:pointer;">💾 套用並存檔重整</button>
        </div>`;
    document.body.appendChild(panel);

    // ===== 5a-2. 分頁切換（5 類：數值/存檔・遊戲機制參數修改(預設)・寵物管理・裝備產生器・技能/背包）=====
    window.__geoModSwitchTab = function (name) {
        document.querySelectorAll('#geo-mod-panel .modtab').forEach(function (el) {
            el.style.display = (el.getAttribute('data-tab') === name) ? 'flex' : 'none';
        });
        document.querySelectorAll('#geo-mod-panel .modtab-btn').forEach(function (btn) {
            let active = btn.getAttribute('data-tabbtn') === name;
            btn.style.background = active ? '#2563eb' : '#334155';
            btn.style.color = active ? '#fff' : '#94a3b8';
        });
        let content = document.getElementById('geo-mod-panel').querySelector('div[style*="overflow-y:auto"]');
        if (content) content.scrollTop = 0;
    };
    window.__geoModSwitchTab('stats');   // 預設開在「數值/存檔」

    // ===== 5b. 懸浮縮小圖示（面板縮小時顯示，點擊展開回完整面板）=====
    let oldFab = document.getElementById('geo-mod-fab');
    if (oldFab) oldFab.remove();
    let fab = document.createElement('div');
    fab.id = 'geo-mod-fab';
    fab.title = '展開放置天堂修改器';
    fab.style.cssText = `
        display: none; position: fixed; top: 10px; right: 10px; width: 48px; height: 48px;
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border: 3px solid #3b82f6;
        border-radius: 50%; z-index: 999999; align-items: center; justify-content: center;
        font-size: 22px; cursor: pointer; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);`;
    fab.textContent = '🏰';
    fab.onclick = function () {
        document.getElementById('geo-mod-panel').style.display = 'flex';
        fab.style.display = 'none';
    };
    document.body.appendChild(fab);

    // ===== 8. 背包即時預覽 =====
    function updateInvPanel() {
        let c = document.getElementById('mod-inv-container');
        c.innerHTML = '';
        if (!player.inv || !player.inv.length) {
            c.innerHTML = '<span style="color:#64748b; font-style:italic;">背包空無一物</span>';
            document.getElementById('mod-inv-count').innerText = 0;
            return;
        }
        document.getElementById('mod-inv-count').innerText = player.inv.length;
        player.inv.forEach((item, index) => {
            let db = DB.items[item.id] || { n: "未知" };
            let tier = item.anc === 'eternal' ? "永恆 " : item.anc === 'immortal' ? "不朽 "
                : item.anc === 'primordial' ? "太初 " : item.anc === true ? "遠古 " : "";
            let status = item.bless === 'cursed' ? "詛咒的 " : item.bless === true ? "祝福的 " : "";
            let en = item.en > 0 ? `+${item.en} ` : "";
            // 屬性顯示：支援新碼(fr/wa/wi/ea)與舊碼(fire1等)自動映射
            let ATTR_LEGACY = { fire1:'fr1', fire3:'fr2', fire5:'fr3', water1:'wa1', water3:'wa2', water5:'wa3', wind1:'wi1', wind3:'wi2', wind5:'wi3', earth1:'ea1', earth3:'ea2', earth5:'ea3' };
            let attrCode = item.attr ? (ATTR_MAP[item.attr] ? item.attr : ATTR_LEGACY[item.attr]) : null;
            let attr = (attrCode && ATTR_MAP[attrCode]) ? ATTR_MAP[attrCode] + " " : "";
            let cnt = item.cnt > 1 ? ` x${item.cnt}` : "";
            let lock = item.lock ? "🔒" : "";
            let seteff = item.seteff ? `<span style="color:#4ade80;"> ✦${item.seteff}</span>` : "";
            let row = document.createElement('div');
            let lc = item.seteff ? "#22c55e" : item.anc === 'eternal' ? "#ef4444" : item.anc === 'immortal' ? "#22c55e"
                : item.anc === 'primordial' ? "#3b82f6" : item.anc === true ? "#a855f7" : "#3b82f6";
            row.style.cssText = `display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:4px 8px; border-radius:4px; font-size:12px; border-left:3px solid ${lc};`;
            row.innerHTML = `<span style="color:#f1f5f9;">${lock}${attr}${tier}${status}${en}${db.n}${cnt}${seteff}</span>
                <button data-idx="${index}" class="btn-del-item" style="background:#451a03; color:#f87171; border:1px solid #991b1b; padding:1px 6px; border-radius:3px; cursor:pointer;">移除</button>`;
            c.appendChild(row);
        });
        c.querySelectorAll('.btn-del-item').forEach(btn => {
            btn.onclick = function () { player.inv.splice(parseInt(this.getAttribute('data-idx')), 1); updateInvPanel(); };
        });
    }

    // ===== 8a-2. 裝備本體切換：slot → 合法候選裝備清單 =====
    // 判斷某 slot 該列哪些 DB.items（依 type / slot / isArrow）
    function slotCandidates(slot) {
        const out = [];
        const myCls = player.cls; // knight / mage / elf / dark
        const reqOK = (req) => {
            if (!req) return true;                 // 無限制
            const list = String(req).split(',').map(s => s.trim());
            if (list.includes('all')) return true;
            return myCls ? list.includes(myCls) : true; // 無職業資訊時全列
        };
        Object.entries(DB.items).forEach(([id, v]) => {
            let match = false;
            if (slot === 'wpn')        match = (v.type === 'wpn' && !v.isArrow);
            else if (slot === 'offwpn') match = (v.type === 'wpn' && !v.isArrow);   // ⚔️ 副手武器（戰士迅猛雙斧雙持）：與主手同池，非防具
            else if (slot === 'arrow') match = (v.type === 'wpn' && v.isArrow === true);
            else if (slot === 'ring1' || slot === 'ring2' || slot === 'ring3' || slot === 'ring4') match = (v.type === 'acc' && v.slot === 'ring');
            else if (slot === 'amulet') match = (v.type === 'acc' && v.slot === 'amulet');
            else if (slot === 'belt')   match = (v.type === 'acc' && v.slot === 'belt');
            else if (slot === 'pet')    match = (v.type === 'acc' && v.slot === 'pet');
            else if (slot === 'ear1' || slot === 'ear2') match = (v.type === 'acc' && v.slot === 'ear');
            else if (slot === 'doll')   match = (v.type === 'acc' && v.slot === 'doll');
            else match = (v.type === 'arm' && v.slot === slot); // helm/armor/shield/cloak/tshirt/gloves/boots
            if (match && reqOK(v.req)) out.push([id, v.n || id]);
        });
        // 依名稱排序，方便尋找
        out.sort((a, b) => a[1].localeCompare(b[1], 'zh-Hant'));
        return out;
    }
    // 本體切換下拉（與 buildSel 同風格，但選項是 [id, 名稱]）
    const buildItemSel = (selId, cands, currentId) => {
        let h = `<select id="${selId}" style="background:#03122b; color:#fde68a; border:1px solid #b45309; padding:1px; font-size:11px; max-width:150px;">`;
        let hasCurrent = cands.some(([id]) => id === currentId);
        if (!hasCurrent) {
            const cn = (DB.items[currentId] && DB.items[currentId].n) || currentId;
            h += `<option value="${currentId}" selected style="color:#f87171;">⚠ ${cn}（非本職/特殊）</option>`;
        }
        cands.forEach(([id, name]) => {
            h += `<option value="${id}"${id === currentId ? ' selected' : ''} style="color:#fde68a;">${name}</option>`;
        });
        return h + '</select>';
    };

    // ===== 8b. 已穿戴裝備詞綴渲染 =====
    function renderEquipPanel() {
        let box = document.getElementById('mod-eq-container');
        box.innerHTML = '';
        let any = false;
        SLOT_DEFS.forEach(([slot, label]) => {
            let it = player.eq && player.eq[slot];
            if (!it) return;
            any = true;
            let db = DB.items[it.id] || { n: '未知' };
            let isDoll = (slot === 'doll') || (db.noEnhance === true);   // 魔法娃娃：不可強化，隱藏詞綴列
            let row = document.createElement('div');
            row.style.cssText = 'background:#0b1220; border:1px solid #1e3a8a; border-radius:5px; padding:6px;';
            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="color:#93c5fd; font-weight:bold; font-size:12px;">[${label}] ${db.n}${it.seteff ? `<span style="color:#4ade80;"> ✦${it.seteff}</span>` : ''}</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; font-size:11px; color:#94a3b8; margin-bottom:4px;">
                    <span style="color:#fbbf24;">種類:</span>${buildItemSel(`eq-${slot}-id`, slotCandidates(slot), it.id)}
                </div>
                ${isDoll ? `<div style="font-size:11px; color:#64748b;">此部位不可強化，只能切換種類。</div>` : `
                <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; font-size:11px; color:#94a3b8;">
                    +<input type="number" id="eq-${slot}-en" value="${it.en || 0}" style="width:42px; background:#000; color:#fff; text-align:center; border:1px solid #475569;">
                    ${buildSel(`eq-${slot}-tier`, TIER_ITEMS, ancToVal(it.anc), 'width:78px;')}
                    ${buildSel(`eq-${slot}-status`, STATUS_ITEMS, blessToVal(it.bless), 'width:70px;')}
                    ${buildSel(`eq-${slot}-attr`, ATTR_ITEMS, (it.attr || 'false'), 'width:96px;').replace('<select ', `<select onchange="window.__geoModAttrMagicSync('${slot}')" `)}
                    ${buildSel(`eq-${slot}-seteff`, SETEFF_ITEMS, (it.seteff || 'false'), 'width:112px;')}
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; font-size:11px; color:#94a3b8; margin-top:2px;">
                    <span style="color:#facc15;">🌟屬性附加魔法:</span>
                    <span id="eq-${slot}-attrmagic-wrap">${buildAttrMagicSelectHtml(`eq-${slot}-attrmagic`, (it.attr || 'false'), it.attrMagic || null)}</span>
                    <span style="color:#38bdf8;">星級</span>${buildSel(`eq-${slot}-attrmagicstar`, [['1','★1','#fff'],['2','★★2','#facc15'],['3','★★★3','#f97316']], String(it.attrMagicStar || 1), 'width:64px;')}
                </div>
                <div style="font-size:10px; color:#64748b;">※ 只有同元素 5 階屬性才能附加（跟遊戲內建卷軸附加規則一致）；改動上方「屬性」後選單會自動更新，星級＝觸發率倍率 ×1/×2/×3。</div>`}`;
            box.appendChild(row);
        });
        if (!any) box.innerHTML = '<span style="color:#64748b; font-style:italic;">目前沒有穿戴任何裝備。</span>';
    }

    // 套用穿戴裝備的詞綴改動（就地寫回 player.eq[slot]，保留 id/uid/cnt）
    document.getElementById('btn-apply-eq').onclick = function () {
        let changed = 0;
        SLOT_DEFS.forEach(([slot]) => {
            let it = player.eq && player.eq[slot];
            if (!it) return;
            // 本體種類切換（所有格皆可，含娃娃）：只換 id，詞綴全保留；換成功補 uid
            let idEl = document.getElementById(`eq-${slot}-id`);
            if (idEl && idEl.value && idEl.value !== it.id) {
                it.id = idEl.value;
                if (hasFn('uid')) it.uid = uid(); // 換本體後重編 uid 避免穿戴判定衝突
                changed++;
            }
            // 詞綴列（娃娃等 noEnhance 部位沒有這些輸入 → 跳過，只換種類）
            let enEl = document.getElementById(`eq-${slot}-en`);
            if (!enEl) return;
            it.en = parseInt(enEl.value) || 0;
            it.anc = valToAnc(document.getElementById(`eq-${slot}-tier`).value);
            it.bless = valToBless(document.getElementById(`eq-${slot}-status`).value);
            let av = document.getElementById(`eq-${slot}-attr`).value; it.attr = av === 'false' ? false : av;
            let sv = document.getElementById(`eq-${slot}-seteff`).value; it.seteff = sv === 'false' ? false : sv;
            // 🌟 屬性附加魔法（attrMagic/attrMagicStar）：只有下拉未被 disabled（＝目前屬性已是同元素5階）才動作
            let amEl = document.getElementById(`eq-${slot}-attrmagic`);
            if (amEl && !amEl.disabled) {
                let amv = amEl.value;
                if (!amv || amv === 'none') { delete it.attrMagic; delete it.attrMagicStar; }
                else {
                    it.attrMagic = amv;
                    let starEl = document.getElementById(`eq-${slot}-attrmagicstar`);
                    it.attrMagicStar = Math.max(1, Math.min(3, parseInt(starEl && starEl.value, 10) || 1));
                }
            }
            changed++;
        });
        liveRefresh();          // 重算屬性 + 套裝加成 + 刷新遊戲 UI
        renderEquipPanel();     // 重繪面板（同步顯示）
        alert(`🧿 已即時套用 ${changed} 件穿戴裝備的詞綴改動（尚未寫檔，按底部綠色鈕固化）。`);
    };

    // ===== 9. 生成道具 =====
    // 🔍 道具搜尋：即時過濾下拉選項（保留 optgroup，依名稱/ID 關鍵字隱藏不符項）
    (function setupItemSearch() {
        const sel = document.getElementById('add-id');
        const box = document.getElementById('add-search');
        const cnt = document.getElementById('add-count');
        if (!sel || !box) return;
        // 記錄原始全部 optgroup/option（HTML 字串），方便重建
        const fullHtml = sel.innerHTML;
        const doFilter = () => {
            const kw = box.value.trim().toLowerCase();
            if (!kw) { sel.innerHTML = fullHtml; if (cnt) cnt.textContent = ''; return; }
            // 解析全部 option，比對名稱或 id
            const tmp = document.createElement('select');
            tmp.innerHTML = fullHtml;
            let shown = 0, html = '';
            tmp.querySelectorAll('optgroup').forEach(og => {
                let opts = '';
                og.querySelectorAll('option').forEach(o => {
                    if (o.textContent.toLowerCase().includes(kw) || o.value.toLowerCase().includes(kw)) {
                        opts += `<option value="${o.value}">${o.textContent}</option>`;
                        shown++;
                    }
                });
                if (opts) html += `<optgroup label="${og.label}" style="background:#0f172a; color:#94a3b8;">${opts}</optgroup>`;
            });
            sel.innerHTML = html || '<option value="">（無符合項目）</option>';
            if (cnt) cnt.textContent = `符合 ${shown} 項`;
        };
        box.addEventListener('input', doFilter);
    })();

    document.getElementById('btn-add-item').onclick = function () {
        let id = document.getElementById('add-id').value;
        let tier = document.getElementById('add-tier').value;
        let status = document.getElementById('add-status').value;
        let en = parseInt(document.getElementById('add-en').value) || 0;
        let cnt = parseInt(document.getElementById('add-cnt').value) || 1;
        let attrVal = document.getElementById('add-attr').value;
        let seteffVal = document.getElementById('add-seteff').value;
        let lock = document.getElementById('add-lock').checked;

        let newItem = {
            id, cnt, en,
            bless: status === 'bless' ? true : status === 'cursed' ? 'cursed' : false,
            anc: tier === 'true' ? true : ['eternal', 'immortal', 'primordial'].includes(tier) ? tier : false,
            attr: attrVal === 'false' ? false : attrVal,
            seteff: seteffVal === 'false' ? false : seteffVal,
            lock, junk: false
        };
        // 🌟 屬性附加魔法：下拉未被 disabled（＝上面選的屬性剛好同元素5階）才寫入
        let amEl = document.getElementById('add-attrmagic');
        if (amEl && !amEl.disabled && amEl.value && amEl.value !== 'none') {
            newItem.attrMagic = amEl.value;
            let starEl = document.getElementById('add-attrmagicstar');
            newItem.attrMagicStar = Math.max(1, Math.min(3, parseInt(starEl && starEl.value, 10) || 1));
        }
        if (hasFn('uid')) newItem.uid = uid();   // 補 uid：避免之後在遊戲裡穿戴/堆疊判定出錯
        // 🏺 巨靈的三個願望：比照遊戲原生 gainItem（08-items-equip.js）在產生瞬間從 17 種能力隨機抽 3 個（不重複）存於 gw，
        //    否則修改器產生的戒指會缺少願望數值（calcStats/tooltip 都靠 item.gw 消費）。
        if (id === 'relic_genie_wishes') {
            let _pool = ['hp60','mp30','md3','rd3','mdmg2','sp6','hpr10','mpr5','dr3','ac3','mr6','str1','dex1','int1','wis1','con1','cha1'];
            let _gw = [];
            for (let _k = 0; _k < 3; _k++) {
                let _ri = Math.floor((typeof lootRng === 'function' ? lootRng('geniewish') : Math.random()) * _pool.length);
                _gw.push(_pool.splice(_ri, 1)[0]);
            }
            newItem.gw = _gw;
        }
        if (!player.inv) player.inv = [];
        player.inv.push(newItem);
        updateInvPanel();
    };

    // ===== 9b. 自訂魔法武器產生器 =====
    // 各武器型態的基礎數值（取自遊戲既有同分類武器當基準；分類鍵值與 EQUIP_CATEGORIES／equipCatKey 完全一致，見 js/16-equip-book.js）
    const CW_BASE = {
        dagger:     { dmgS: 2,  dmgL: 3,  spd: 0.6, isBow: false, w2h: false, hit: 2 },
        sword1:     { dmgS: 8,  dmgL: 12, spd: 0.9, isBow: false, w2h: false, hit: 0 },
        sword2:     { dmgS: 14, dmgL: 16, spd: 1.0, isBow: false, w2h: true,  hit: 0 },
        katana:     { dmgS: 10, dmgL: 12, spd: 0.9, isBow: false, w2h: false, hit: 1 },
        blunt1:     { dmgS: 3,  dmgL: 5,  spd: 1.0, isBow: false, w2h: false, hit: 0 },
        blunt2:     { dmgS: 18, dmgL: 18, spd: 1.1, isBow: false, w2h: true,  hit: 0 },
        spear:      { dmgS: 6,  dmgL: 10, spd: 1.0, isBow: false, w2h: true,  hit: 0 },
        claw:       { dmgS: 8,  dmgL: 7,  spd: 0.9, isBow: false, w2h: true,  hit: 2 },
        dual:       { dmgS: 8,  dmgL: 6,  spd: 0.8, isBow: false, w2h: true,  hit: 3 },
        chainsword: { dmgS: 14, dmgL: 12, spd: 1.0, isBow: false, w2h: true,  hit: 4 },
        bow:        { dmgS: 2,  dmgL: 2,  spd: 1.0, isBow: true,  w2h: false, hit: 0 },
        xbow:       { dmgS: 3,  dmgL: 2,  spd: 1.0, isBow: true,  w2h: true,  hit: 3 },
        wand:       { dmgS: 4,  dmgL: 5,  spd: 1.0, isBow: false, w2h: false, hit: 0, isWand: true },
        qigu:       { dmgS: 25, dmgL: 25, spd: 0.8, isBow: false, w2h: false, hit: 0, qigu: true },
        wpn_other:  { dmgS: 15, dmgL: 11, spd: 1.0, isBow: false, w2h: false, hit: 5 }
    };
    // 🖼️ 圖示候選清單：只收「真實存在」的遊戲武器（排除自訂武器本身，避免借到另一把沒圖的自訂武器）
    //   分類改用 equipCatKey()（與裝備收集冊/遺物收集冊同一顆函式）精準判斷，取代舊版 isBow/w2h/spd 猜測式歸類——
    //   邏輯與防具的 ca-icon（用 d.slot 精準比對）一致，例如選「匕首」只會列出真正的匕首，不會混到魔杖或矛。
    const WPN_ICON_LIST = (() => {
        const seen = new Set(), out = [];
        try {
            for (let id in DB.items) {
                if (id.indexOf('wpn_custom_') === 0) continue;
                const d = DB.items[id];
                if (!d || d.type !== 'wpn' || !d.n || seen.has(d.n)) continue;
                const ck = (typeof equipCatKey === 'function') ? equipCatKey(id, d) : null;
                if (!ck) continue;   // 無法分類（例如遺物箭筒）不列入借用清單
                seen.add(d.n);
                out.push({ id, n: d.n, cat: ck });
            }
        } catch (e) {}
        out.sort((a, b) => a.n.localeCompare(b.n, 'zh-Hant'));
        return out;
    })();
    const cwUpdateIconPreview = () => {
        const sel = document.getElementById('cw-icon'), img = document.getElementById('cw-icon-preview');
        if (!sel || !img || !sel.value) return;
        const d = DB.items[sel.value];
        if (d && typeof getIconUrl === 'function') img.src = getIconUrl(d);
    };
    const populateCwIconSelect = (preserve) => {
        const sel = document.getElementById('cw-icon');
        const baseSel = document.getElementById('cw-base');
        const allChk = document.getElementById('cw-icon-all');
        if (!sel || !baseSel) return;
        const showAll = allChk && allChk.checked;
        let list = showAll ? WPN_ICON_LIST : WPN_ICON_LIST.filter(w => w.cat === baseSel.value);
        if (!list.length) list = WPN_ICON_LIST;   // 該分類找不到就退回全部，永遠有得選
        const prev = preserve ? sel.value : null;
        sel.innerHTML = list.map(w => `<option value="${w.id}">${w.n}</option>`).join('');
        if (prev && list.some(w => w.id === prev)) sel.value = prev;
        cwUpdateIconPreview();
    };
    { const b = document.getElementById('cw-base'), i = document.getElementById('cw-icon'), a = document.getElementById('cw-icon-all');
      if (b) b.addEventListener('change', () => populateCwIconSelect(false));
      if (i) i.addEventListener('change', cwUpdateIconPreview);
      if (a) a.addEventListener('change', () => populateCwIconSelect(true));
      populateCwIconSelect(false); }
    // 👹 裝備變身選單：從遊戲既有 POLY_TIERS 撈全部型態名，依等級分組
    (function populateMorphSelect() {
        const sel = document.getElementById('cw-morph');
        if (!sel || typeof POLY_TIERS === 'undefined') return;
        let html = '<option value="">（無變身）</option>';
        POLY_TIERS.forEach(tier => {
            html += `<optgroup label="Lv${tier.min}-${tier.max}">`;
            tier.forms.forEach(f => { html += `<option value="${f.n}">${f.n}（Lv${f.lv}）</option>`; });
            html += '</optgroup>';
        });
        sel.innerHTML = html;
    })();
    // 即時預覽（發動率 / 傷害倍率）
    const cwUpdatePreview = () => {
        const en = parseInt(document.getElementById('cw-en').value) || 0;
        const rEl = document.getElementById('cw-preview-rate');
        const dEl = document.getElementById('cw-preview-dmg');
        const procMode = document.getElementById('cw-procmode') ? document.getElementById('cw-procmode').value : 'scale';
        if (rEl) {
            if (procMode === 'fixed') {
                const pf = parseInt(document.getElementById('cw-procfixed').value) || 1;
                rEl.textContent = pf + '%（固定）';
            } else {
                rEl.textContent = (1 + en) + '%';
            }
        }
        if (dEl) dEl.textContent = '×' + (1 + en / 10).toFixed(1);
    };
    ['cw-en','cw-procfixed'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', cwUpdatePreview);
    });
    // 特效傷害模式切換：顯示/隱藏 骰子列 vs 固定值列
    const cwDmgMode = document.getElementById('cw-dmgmode');
    if (cwDmgMode) {
        cwDmgMode.addEventListener('change', function () {
            const fixed = this.value === 'fixed';
            const diceRow = document.getElementById('cw-dice-row');
            const fixedRow = document.getElementById('cw-fixed-row');
            if (diceRow) diceRow.style.display = fixed ? 'none' : '';
            if (fixedRow) fixedRow.style.display = fixed ? '' : 'none';
        });
    }
    // 發動機率模式切換：顯示/隱藏 固定機率列
    const cwProcMode = document.getElementById('cw-procmode');
    if (cwProcMode) {
        cwProcMode.addEventListener('change', function () {
            const fixed = this.value === 'fixed';
            const row = document.getElementById('cw-procfixed-row');
            if (row) row.style.display = fixed ? '' : 'none';
            cwUpdatePreview();
        });
    }

    let cwEditingId = null;   // 編輯模式：非 null 時鍛造會覆寫此 id 而非產生新武器
    document.getElementById('btn-add-cw').onclick = function () {
        const name = (document.getElementById('cw-name').value || '我的魔法武器').trim();
        const base = document.getElementById('cw-base').value;
        const skn  = (document.getElementById('cw-skn').value || '魔法爆發').trim();
        const ele  = document.getElementById('cw-ele').value;
        // 特效傷害：骰子 或 固定值（固定值＝dice:[N,1]，roll(N,1)=N）
        const dmgMode = document.getElementById('cw-dmgmode').value;
        let diceN, diceF;
        if (dmgMode === 'fixed') {
            diceN = Math.max(1, parseInt(document.getElementById('cw-fixeddmg').value) || 1);
            diceF = 1;
        } else {
            diceN = Math.max(1, parseInt(document.getElementById('cw-dicen').value) || 1);
            diceF = Math.max(1, parseInt(document.getElementById('cw-dicef').value) || 1);
        }
        const req  = document.getElementById('cw-req').value;
        const en   = Math.max(0, parseInt(document.getElementById('cw-en').value) || 0);
        // 基礎傷害覆寫（留空＝用型態預設）
        const dmgsRaw = document.getElementById('cw-dmgs').value.trim();
        const dmglRaw = document.getElementById('cw-dmgl').value.trim();

        // 🩸 吸血/吸魔
        const vamp = document.getElementById('cw-vamp').checked
            ? Math.min(1, Math.max(0.01, (parseInt(document.getElementById('cw-vamp-pct').value) || 5) / 100)) : 0;
        const mpOnHit = document.getElementById('cw-mponhit').checked;
        const spHeal = document.getElementById('cw-spheal').checked
            ? Math.min(1, Math.max(0.01, (parseInt(document.getElementById('cw-spheal-pct').value) || 20) / 100)) : 0;

        // 🌐 攻擊全體 + 發動機率模式
        const aoe = document.getElementById('cw-aoe').checked;
        const procMode = document.getElementById('cw-procmode').value;
        const procFixed = Math.min(100, Math.max(1, parseInt(document.getElementById('cw-procfixed').value) || 100));

        // 📊 六圍被動加成
        const sixStat = {};
        ['str','dex','con','int','wis','cha'].forEach(k => { const v = parseInt(document.getElementById('cw-' + k).value) || 0; if (v) sixStat[k] = v; });
        // 👹 裝備變身
        const morphName = document.getElementById('cw-morph') ? document.getElementById('cw-morph').value : '';

        const b = CW_BASE[base] || CW_BASE.bow;
        const iconFrom = document.getElementById('cw-icon') ? document.getElementById('cw-icon').value : '';
        // 唯一 id：編輯模式沿用原 id（覆寫定義），否則固定前綴 + 時間戳
        const cwId = cwEditingId || ('wpn_custom_' + Date.now().toString(36));
        const spec = Object.assign({
            n: name, skn, ele, diceN, diceF, req,
            base: base,
            dmgS: dmgsRaw !== '' ? Math.max(0, parseInt(dmgsRaw) || 0) : b.dmgS,
            dmgL: dmglRaw !== '' ? Math.max(0, parseInt(dmglRaw) || 0) : b.dmgL,
            spd: b.spd, hit: b.hit,
            isBow: b.isBow, w2h: b.w2h, isWand: !!b.isWand, qigu: !!b.qigu,
            iconFrom: iconFrom,
            vampPct: vamp, mpOnHit: mpOnHit, spHeal: spHeal,
            aoe: aoe, procMode: procMode, procFixed: procFixed,
            morphName: morphName
        }, sixStat);

        // 1) 注入 DB.items（本次 session 立即可用）
        DB.items[cwId] = buildWeaponDef(spec);
        // 2) 存 localStorage（持久化，下次載入修改器自動重新注入）
        const all = loadCustomWeapons();
        all[cwId] = spec;
        saveCustomWeapons(all);
        // 3) 若非編輯模式，產生新物品實例放入背包（編輯模式只更新定義，不重複生成道具；已持有的實例自動套用新定義）
        if (!cwEditingId) {
            let attrCode = (ele !== 'none' && ATTR_PREFIX[ele]) ? (ATTR_PREFIX[ele] + '5') : false;
            let newItem = { id: cwId, cnt: 1, en, bless: false, anc: false, attr: attrCode, seteff: false, lock: true, junk: false };
            if (hasFn('uid')) newItem.uid = uid();
            if (!player.inv) player.inv = [];
            player.inv.push(newItem);
            updateInvPanel();
        }
        liveRefresh();
        renderCwList();
        let extra = '';
        if (aoe) extra += `\n🌐 特效攻擊全體`;
        if (vamp) extra += `\n🩸 吸血 ${Math.round(vamp * 100)}%`;
        if (mpOnHit) extra += `\n💧 命中回MP`;
        if (spHeal) extra += `\n✨ 特效吸血 ${Math.round(spHeal * 100)}%`;
        if (Object.keys(sixStat).length) extra += `\n📊 六圍加成：` + Object.entries(sixStat).map(([k,v]) => `${k}+${v}`).join('、');
        if (morphName) extra += `\n👹 裝備時變身：${morphName}`;
        let rateText = (procMode === 'fixed') ? `固定 ${procFixed}%` : `${1 + en}%（隨強化）`;
        if (cwEditingId) {
            alert(`✏️ 已更新「${name}」的定義！\n發動率 ${rateText}、特效傷害 ${diceN}D${diceF}${diceF>1?'×'+(1 + en / 10).toFixed(1):''}（${skn}）。${extra}\n已持有的同款武器會立即套用新定義。已存入瀏覽器，記得按底部綠色鈕寫檔。\n\n⚠ 下次進遊戲後請再執行一次修改器，變更才會生效。`);
            cwEditingId = null;
            document.getElementById('btn-add-cw').textContent = '🔮 鍛造並放入背包';
        } else {
            alert(`🔮 已鍛造「${name}」+${en}！\n發動率 ${rateText}、特效傷害 ${diceN}D${diceF}${diceF>1?'×'+(1 + en / 10).toFixed(1):''}（${skn}）。${extra}\n已放入背包並存入瀏覽器，記得按底部綠色鈕寫檔。\n\n⚠ 下次進遊戲後請再執行一次修改器，武器才會生效。`);
        }
    };

    document.getElementById('btn-clear-cw').onclick = function () {
        if (!confirm("確定清除所有自訂武器規格？\n已放進背包/穿在身上的自訂武器，重整後將失效（變成未知物品）。")) return;
        try { localStorage.removeItem(CW_KEY); } catch (e) {}
        alert("🗑 已清除所有自訂武器規格。");
        renderCwList();
    };

    // 📋 自訂武器清單：編輯（帶回表單覆寫同 id）／刪除（單把）／再鍛造（同定義、指定新強化值放入背包）
    function renderCwList() {
        const host = document.getElementById('cw-list');
        if (!host) return;
        const all = loadCustomWeapons();
        const ids = Object.keys(all);
        if (!ids.length) { host.innerHTML = '<div style="color:#64748b; font-size:11px;">（尚未創建任何自訂武器）</div>'; return; }
        host.innerHTML = ids.map(id => {
            const s = all[id];
            const img = (DB.items[id] && typeof getIconUrl === 'function') ? getIconUrl(DB.items[id]) : '';
            const effTxt = `${s.skn}｜${s.diceN}D${s.diceF}${s.ele !== 'none' ? '｜' + s.ele : ''}`;
            const morphTxt = s.morphName ? `｜👹${s.morphName}` : '';
            return `<div style="display:flex; align-items:center; gap:6px; background:#0f172a; border:1px solid #334155; border-radius:4px; padding:4px 6px;">
                <img src="${img}" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;" onerror="this.style.opacity=0.2">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12px; color:#fde68a; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.n}</div>
                    <div style="font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${effTxt}${morphTxt}</div>
                </div>
                <input type="number" value="9" min="0" id="cw-reen-${id}" style="width:36px; background:#000; color:#fff; text-align:center; border:1px solid #475569; font-size:11px;" title="再鍛造的強化值">
                <button data-cwid="${id}" class="cw-btn-reforge" style="background:#16a34a; color:#fff; border:none; padding:3px 6px; border-radius:3px; font-size:11px; cursor:pointer;">再鍛造</button>
                <button data-cwid="${id}" class="cw-btn-edit" style="background:#2563eb; color:#fff; border:none; padding:3px 6px; border-radius:3px; font-size:11px; cursor:pointer;">編輯</button>
                <button data-cwid="${id}" class="cw-btn-del" style="background:#7f1d1d; color:#fca5a5; border:none; padding:3px 6px; border-radius:3px; font-size:11px; cursor:pointer;">刪除</button>
            </div>`;
        }).join('');
        host.querySelectorAll('.cw-btn-del').forEach(btn => btn.onclick = function () {
            const id = this.getAttribute('data-cwid');
            const s = all[id];
            if (!confirm(`確定刪除「${s.n}」的規格？\n已持有/裝備的此把武器重整後將變成未知物品。`)) return;
            const cur = loadCustomWeapons();
            delete cur[id];
            saveCustomWeapons(cur);
            delete DB.items[id];
            renderCwList();
        });
        host.querySelectorAll('.cw-btn-edit').forEach(btn => btn.onclick = function () {
            const id = this.getAttribute('data-cwid');
            const s = all[id];
            document.getElementById('cw-name').value = s.n;
            document.getElementById('cw-skn').value = s.skn;
            document.getElementById('cw-ele').value = s.ele;
            document.getElementById('cw-req').value = s.req;
            document.getElementById('cw-dmgmode').value = (s.diceF === 1) ? 'fixed' : 'dice';
            document.getElementById('cw-dmgmode').dispatchEvent(new Event('change'));
            if (s.diceF === 1) document.getElementById('cw-fixeddmg').value = s.diceN;
            else { document.getElementById('cw-dicen').value = s.diceN; document.getElementById('cw-dicef').value = s.diceF; }
            document.getElementById('cw-dmgs').value = s.dmgS != null ? s.dmgS : '';
            document.getElementById('cw-dmgl').value = s.dmgL != null ? s.dmgL : '';
            document.getElementById('cw-vamp').checked = !!s.vampPct;
            if (s.vampPct) document.getElementById('cw-vamp-pct').value = Math.round(s.vampPct * 100);
            document.getElementById('cw-mponhit').checked = !!s.mpOnHit;
            document.getElementById('cw-spheal').checked = !!s.spHeal;
            if (s.spHeal) document.getElementById('cw-spheal-pct').value = Math.round(s.spHeal * 100);
            document.getElementById('cw-aoe').checked = !!s.aoe;
            document.getElementById('cw-procmode').value = s.procMode || 'scale';
            document.getElementById('cw-procmode').dispatchEvent(new Event('change'));
            if (s.procFixed) document.getElementById('cw-procfixed').value = s.procFixed;
            // 型態還原：優先用建立時存下的 base 鍵值（精準）；舊資料沒存過才退回 isBow/w2h 猜測
            let baseKey = (s.base && CW_BASE[s.base]) ? s.base
                : (Object.keys(CW_BASE).find(k => CW_BASE[k].isBow === !!s.isBow && CW_BASE[k].w2h === !!s.w2h) || 'bow');
            document.getElementById('cw-base').value = baseKey;
            populateCwIconSelect(false);
            if (s.iconFrom) { document.getElementById('cw-icon').value = s.iconFrom; cwUpdateIconPreview(); }
            ['str','dex','con','int','wis','cha'].forEach(k => { document.getElementById('cw-' + k).value = s[k] || 0; });
            document.getElementById('cw-morph').value = s.morphName || '';
            cwEditingId = id;
            document.getElementById('btn-add-cw').textContent = '✏️ 更新「' + s.n + '」的定義';
            document.getElementById('btn-add-cw').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        host.querySelectorAll('.cw-btn-reforge').forEach(btn => btn.onclick = function () {
            const id = this.getAttribute('data-cwid');
            const s = all[id];
            const en = Math.max(0, parseInt(document.getElementById('cw-reen-' + id).value) || 0);
            let attrCode = (s.ele !== 'none' && ATTR_PREFIX[s.ele]) ? (ATTR_PREFIX[s.ele] + '5') : false;
            let newItem = { id, cnt: 1, en, bless: false, anc: false, attr: attrCode, seteff: false, lock: true, junk: false };
            if (hasFn('uid')) newItem.uid = uid();
            if (!player.inv) player.inv = [];
            player.inv.push(newItem);
            updateInvPanel();
            alert(`🔮 已再鍛造一把「${s.n}」+${en}，放入背包。`);
        });
    }
    renderCwList();

    // ===== 9c. 自訂防具/飾品產生器 =====
    const ARM_ICON_LIST = (() => {
        const seen = new Set(), out = [];
        try {
            for (let id in DB.items) {
                if (id.indexOf('arm_custom_') === 0 || id.indexOf('acc_custom_') === 0) continue;
                const d = DB.items[id];
                if (!d || (d.type !== 'arm' && d.type !== 'acc') || !d.n || !d.slot || seen.has(d.n)) continue;
                seen.add(d.n);
                out.push({ id, n: d.n, slot: d.slot });
            }
        } catch (e) {}
        out.sort((a, b) => a.n.localeCompare(b.n, 'zh-Hant'));
        return out;
    })();
    const caUpdateIconPreview = () => {
        const sel = document.getElementById('ca-icon'), img = document.getElementById('ca-icon-preview');
        if (!sel || !img || !sel.value) return;
        const d = DB.items[sel.value];
        if (d && typeof getIconUrl === 'function') img.src = getIconUrl(d);
    };
    const populateCaIconSelect = (preserve) => {
        const sel = document.getElementById('ca-icon');
        const slotSel = document.getElementById('ca-slot');
        const allChk = document.getElementById('ca-icon-all');
        if (!sel || !slotSel) return;
        const showAll = allChk && allChk.checked;
        let list = showAll ? ARM_ICON_LIST : ARM_ICON_LIST.filter(w => w.slot === slotSel.value);
        if (!list.length) list = ARM_ICON_LIST;
        const prev = preserve ? sel.value : null;
        sel.innerHTML = list.map(w => `<option value="${w.id}">${w.n}</option>`).join('');
        if (prev && list.some(w => w.id === prev)) sel.value = prev;
        caUpdateIconPreview();
    };
    { const s = document.getElementById('ca-slot'), i = document.getElementById('ca-icon'), a = document.getElementById('ca-icon-all');
      if (s) s.addEventListener('change', () => populateCaIconSelect(false));
      if (i) i.addEventListener('change', caUpdateIconPreview);
      if (a) a.addEventListener('change', () => populateCaIconSelect(true));
      populateCaIconSelect(false); }

    const CA_NUM_FIELDS = ['ac','mhp','mmp','hpr','mpr','mr','er','dr','resfire','reswater','reswind','researth','str','dex','con','int','wis','cha'];
    const CA_SPEC_KEY = { hpr:'hpR', mpr:'mpR', resfire:'resFire', reswater:'resWater', reswind:'resWind', researth:'resEarth' };
    let caEditingId = null;
    function readCaForm() {
        const name = (document.getElementById('ca-name').value || '我的裝備').trim();
        const slot = document.getElementById('ca-slot').value;
        const req = document.getElementById('ca-req').value;
        const iconFrom = document.getElementById('ca-icon') ? document.getElementById('ca-icon').value : '';
        const spec = { n: name, slot, req, iconFrom };
        CA_NUM_FIELDS.forEach(f => {
            const v = parseInt(document.getElementById('ca-' + f).value) || 0;
            if (v) spec[CA_SPEC_KEY[f] || f] = v;
        });
        return spec;
    }
    document.getElementById('btn-add-ca').onclick = function () {
        const spec = readCaForm();
        const en = Math.max(0, parseInt(document.getElementById('ca-en').value) || 0);
        const caId = caEditingId || ((ACC_SLOTS.indexOf(spec.slot) >= 0 ? 'acc_custom_' : 'arm_custom_') + Date.now().toString(36));
        DB.items[caId] = buildArmorDef(spec);
        const all = loadCustomArmors();
        all[caId] = spec;
        saveCustomArmors(all);
        if (!caEditingId) {
            let newItem = { id: caId, cnt: 1, en, bless: false, anc: false, attr: false, seteff: false, lock: true, junk: false };
            if (hasFn('uid')) newItem.uid = uid();
            if (!player.inv) player.inv = [];
            player.inv.push(newItem);
            updateInvPanel();
        }
        liveRefresh();
        renderCaList();
        const summary = Object.keys(spec).filter(k => !['n','slot','req','iconFrom'].includes(k)).map(k => `${k}+${spec[k]}`).join('、') || '（無加成）';
        if (caEditingId) {
            alert(`✏️ 已更新「${spec.n}」的定義！\n${summary}\n已持有的同款裝備會立即套用新定義。已存入瀏覽器，記得按底部綠色鈕寫檔。\n\n⚠ 下次進遊戲後請再執行一次修改器，變更才會生效。`);
            caEditingId = null;
            document.getElementById('btn-add-ca').textContent = '🛡️ 打造並放入背包';
        } else {
            alert(`🛡️ 已打造「${spec.n}」+${en}！\n${summary}\n已放入背包並存入瀏覽器，記得按底部綠色鈕寫檔。\n\n⚠ 下次進遊戲後請再執行一次修改器，裝備才會生效。`);
        }
    };
    document.getElementById('btn-clear-ca').onclick = function () {
        if (!confirm("確定清除所有自訂防具/飾品規格？\n已放進背包/穿在身上的自訂裝備，重整後將失效（變成未知物品）。")) return;
        try { localStorage.removeItem(CA_KEY); } catch (e) {}
        alert("🗑 已清除所有自訂防具/飾品規格。");
        renderCaList();
    };
    function renderCaList() {
        const host = document.getElementById('ca-list');
        if (!host) return;
        const all = loadCustomArmors();
        const ids = Object.keys(all);
        if (!ids.length) { host.innerHTML = '<div style="color:#64748b; font-size:11px;">（尚未創建任何自訂防具/飾品）</div>'; return; }
        host.innerHTML = ids.map(id => {
            const s = all[id];
            const img = (DB.items[id] && typeof getIconUrl === 'function') ? getIconUrl(DB.items[id]) : '';
            const effTxt = Object.keys(s).filter(k => !['n','slot','req','iconFrom'].includes(k)).map(k => `${k}+${s[k]}`).join('、') || '（無加成）';
            return `<div style="display:flex; align-items:center; gap:6px; background:#0f172a; border:1px solid #334155; border-radius:4px; padding:4px 6px;">
                <img src="${img}" style="width:24px;height:24px;object-fit:contain;flex-shrink:0;" onerror="this.style.opacity=0.2">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:12px; color:#5eead4; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.n}（${s.slot}）</div>
                    <div style="font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${effTxt}</div>
                </div>
                <input type="number" value="9" min="0" id="ca-reen-${id}" style="width:36px; background:#000; color:#fff; text-align:center; border:1px solid #475569; font-size:11px;" title="再打造的強化值">
                <button data-caid="${id}" class="ca-btn-reforge" style="background:#16a34a; color:#fff; border:none; padding:3px 6px; border-radius:3px; font-size:11px; cursor:pointer;">再打造</button>
                <button data-caid="${id}" class="ca-btn-edit" style="background:#2563eb; color:#fff; border:none; padding:3px 6px; border-radius:3px; font-size:11px; cursor:pointer;">編輯</button>
                <button data-caid="${id}" class="ca-btn-del" style="background:#7f1d1d; color:#fca5a5; border:none; padding:3px 6px; border-radius:3px; font-size:11px; cursor:pointer;">刪除</button>
            </div>`;
        }).join('');
        host.querySelectorAll('.ca-btn-del').forEach(btn => btn.onclick = function () {
            const id = this.getAttribute('data-caid');
            const s = all[id];
            if (!confirm(`確定刪除「${s.n}」的規格？\n已持有/裝備的此件裝備重整後將變成未知物品。`)) return;
            const cur = loadCustomArmors();
            delete cur[id];
            saveCustomArmors(cur);
            delete DB.items[id];
            renderCaList();
        });
        host.querySelectorAll('.ca-btn-edit').forEach(btn => btn.onclick = function () {
            const id = this.getAttribute('data-caid');
            const s = all[id];
            document.getElementById('ca-name').value = s.n;
            document.getElementById('ca-slot').value = s.slot;
            document.getElementById('ca-req').value = s.req || 'all';
            populateCaIconSelect(false);
            if (s.iconFrom) { document.getElementById('ca-icon').value = s.iconFrom; caUpdateIconPreview(); }
            CA_NUM_FIELDS.forEach(f => { document.getElementById('ca-' + f).value = s[CA_SPEC_KEY[f] || f] || 0; });
            caEditingId = id;
            document.getElementById('btn-add-ca').textContent = '✏️ 更新「' + s.n + '」的定義';
            document.getElementById('btn-add-ca').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        host.querySelectorAll('.ca-btn-reforge').forEach(btn => btn.onclick = function () {
            const id = this.getAttribute('data-caid');
            const s = all[id];
            const en = Math.max(0, parseInt(document.getElementById('ca-reen-' + id).value) || 0);
            let newItem = { id, cnt: 1, en, bless: false, anc: false, attr: false, seteff: false, lock: true, junk: false };
            if (hasFn('uid')) newItem.uid = uid();
            if (!player.inv) player.inv = [];
            player.inv.push(newItem);
            updateInvPanel();
            alert(`🛡️ 已再打造一件「${s.n}」+${en}，放入背包。`);
        });
    }
    renderCaList();

    // ===== 10. 快捷操作 =====
    document.getElementById('btn-fill-hpmp').onclick = function () {
        liveRefresh(); // 先重算出最新 mhp/mmp
        player.hp = player.mhp; player.mp = player.mmp;
        liveRefresh();
        alert("❤️ HP/MP 已補滿。");
    };
    document.getElementById('btn-consolidate').onclick = function () {
        if (hasFn('consolidateInventory')) { try { consolidateInventory(); } catch (e) {} }
        updateInvPanel(); liveRefresh();
        alert("🧹 背包已整理（合併同性質未強化物品）。");
    };
    document.getElementById('btn-clear-inv').onclick = function () {
        if (!confirm("確定清空整個背包？此動作無法復原（除非你先匯出存檔）。")) return;
        player.inv = []; updateInvPanel(); liveRefresh();
    };
    document.getElementById('btn-give-proof').onclick = function () {
        if (!DB.items['item_mastery_proof']) { alert("❌ 此版本找不到「精通之證」(item_mastery_proof)。"); return; }
        if (!player.inv) player.inv = [];
        if (player.inv.some(i => i.id === 'item_mastery_proof')) { alert("ℹ️ 背包已有一枚精通之證，無需重複。"); return; }
        player.inv.push({ id: 'item_mastery_proof', cnt: 1, en: 0, bless: false, anc: false, attr: false, seteff: false, lock: false, junk: false });
        updateInvPanel();
        alert("🏅 已放入「精通之證」，回威頓村找「漢」交付即可開啟精通。");
    };
    document.getElementById('btn-all60').onclick = function () {
        STATS.forEach(s => { let el = document.getElementById('mod-' + s.k); if (el) el.value = 99; });
    };
    // 🐉 龍之鑽石數量設定（跨角色共用，與角色存檔無關，設定後立即生效）
    document.getElementById('btn-set-diamonds').onclick = function () {
        let v = Math.max(0, parseInt(document.getElementById('mod-diamonds').value) || 0);
        if (setDiamonds(v)) {
            document.getElementById('mod-diamonds').value = v;
            try { if (typeof _rerenderPandora === 'function') _rerenderPandora(); } catch (e) {}
            alert(`🐉 龍之鑽石已設定為 ${v.toLocaleString()}！（跨角色共用資料，立即生效，不需存檔重整）`);
        } else {
            alert("❌ 寫入失敗，可能是瀏覽器儲存空間問題，請稍後再試。");
        }
    };
    // 🔄 強制刷新黑市商品（走玩家存檔 player.pandoraMarket2，呼叫遊戲本身的 refreshPandoraMarket(true)）
    document.getElementById('btn-refresh-blackmarket').onclick = function () {
        if (typeof refreshPandoraMarket !== 'function') {
            alert("❌ 找不到 refreshPandoraMarket()，可能遊戲版本已變動，此功能暫時失效。");
            return;
        }
        try {
            refreshPandoraMarket(true);
            alert("🔄 黑市 24 件商品已全部強制刷新！建議之後按「套用並存檔」固化，避免離開頁面又被下次自動輪換蓋掉。");
        } catch (e) {
            alert("❌ 刷新失敗：" + e.message);
        }
    };
    // 🔄 清除遺物布告欄冷卻（跨角色共用資料，立即生效）
    document.getElementById('btn-reset-relicboards').onclick = function () {
        if (resetRelicBoards()) {
            alert("🔄 三個遺物布告欄冷卻已全部清除！重新打開遺物市集面板即可看到（跨角色共用資料，不需存檔重整）。");
        } else {
            alert("❌ 找不到布告欄資料，請先開啟過一次遺物市集（潘朵拉 NPC）再試。");
        }
    };
    // 🎁 補齊布告欄兌換材料：掃描 3 個布告欄進行中的委託，背包/倉庫缺什麼兌換材料就補一份進背包
    //   兌換比對邏輯（見 js/24 _findMatches）只認 id 是否存在，委託的 en 一律為 null（不限強化值），所以直接 gainItem 補普通品即可滿足。
    document.getElementById('btn-fulfill-relicboards').onclick = function () {
        let st = readDiamondState();
        if (!st || !Array.isArray(st.boards)) { alert("❌ 找不到布告欄資料，請先開啟過一次遺物市集（潘朵拉 NPC）再試。"); return; }
        let active = st.boards.filter(b => b && b.contract && Array.isArray(b.contract.requirements));
        if (!active.length) { alert("目前 3 個布告欄都沒有進行中的委託（尚未搜尋遺物），沒有材料需要補。"); return; }
        let warehouseItems = [];
        try { let wh = (typeof loadWarehouse === 'function') ? loadWarehouse() : null; if (wh && Array.isArray(wh.items)) warehouseItems = wh.items; } catch (e) {}
        let granted = [];
        active.forEach(b => {
            b.contract.requirements.forEach(req => {
                let have = player.inv.some(it => it && it.id === req.id && (Number(it.cnt) || 1) >= 1)
                    || warehouseItems.some(it => it && it.id === req.id && (Number(it.cnt) || 1) >= 1);
                if (!have && typeof gainItem === 'function') {
                    gainItem(req.id, 1, true, true);   // silent=true(不洗log), forceNormal=true(給乾淨普通品，不影響比對)
                    granted.push((DB.items[req.id] && DB.items[req.id].n) || req.id);
                }
            });
        });
        liveRefresh(); updateInvPanel();
        try { if (typeof _rerenderPandora === 'function') _rerenderPandora(); } catch (e) {}
        alert(granted.length ? ("🎁 已補齊材料：" + granted.join('、') + "\n可以回遺物市集面板按「兌換」了。") : "✅ 材料本來就都齊了，可以直接回遺物市集面板按「兌換」。");
    };
    // 💪 六圍突破80 開關
    const syncStatBreakBtn = () => {
        let el = document.getElementById('stat-break-state');
        if (el) { let on = isStatBreakOn(); el.textContent = on ? '開啟 ✅' : '關閉'; el.parentElement.style.background = on ? '#6d28d9' : '#7c3aed'; }
    };
    document.getElementById('btn-stat-break').onclick = function () {
        let on = isStatBreakOn();
        if (on) {
            try { localStorage.setItem(STAT_CAP_KEY, '0'); } catch (e) {}
            restoreStatBreak();
            liveRefresh();
            alert("💪 六圍突破80已【關閉】，恢復原本 80 上限。");
        } else {
            try { localStorage.setItem(STAT_CAP_KEY, '1'); } catch (e) {}
            let n = applyStatBreak();
            liveRefresh();
            alert(`💪 六圍突破80已【開啟】！\n${n} 個能力效果表改為線性外推，六圍 80 以上將繼續提升能力（越高越強）。\n\n範例：力量100→近戰傷害+55、力量150→+80；智力100→魔法傷害+35。\nHP/MP 成長也一併突破（體質/精神越高血魔越多）。\n\n⚠ 下次進遊戲後請再執行一次修改器，此突破才會持續生效。`);
        }
        syncStatBreakBtn();
    };
    syncStatBreakBtn();

    // ⚡ 戰鬥節奏修改
    const syncTempoUI = () => {
        const t = loadTempo();
        let aEl = document.getElementById('tempo-aspd'), cEl = document.getElementById('tempo-cast'),
            sEl = document.getElementById('tempo-stun'), rEl = document.getElementById('tempo-respawn'),
            stEl = document.getElementById('tempo-state');
        if (aEl) aEl.value = (t.aspd != null ? t.aspd : '');
        if (cEl) cEl.value = (t.castLock != null ? t.castLock : '');
        if (sEl) sEl.value = (t.hitstun != null ? t.hitstun : '');
        if (rEl) rEl.checked = !!t.fastRespawn;
        if (stEl) { stEl.textContent = t.on ? '開啟 ✅' : '關閉'; stEl.parentElement.style.background = t.on ? '#b45309' : '#d97706'; }
    };
    const _hookTempoRecompute = () => {
        if (!window._tempoHooked && typeof window.recomputeStats === 'function') {
            const orig = window.recomputeStats;
            window.recomputeStats = function () { let r = orig.apply(this, arguments); applyTempoToStats(); return r; };
            window._tempoHooked = true;
        }
    };
    document.getElementById('btn-tempo-apply').onclick = function () {
        let t = loadTempo();
        const rd = (id) => { let v = document.getElementById(id).value.trim(); return v === '' ? null : v; };
        t.aspd = rd('tempo-aspd');
        t.castLock = rd('tempo-cast');
        t.hitstun = rd('tempo-stun');
        t.fastRespawn = document.getElementById('tempo-respawn').checked;
        t.on = !t.on;   // 切換開關
        saveTempo(t);
        if (t.on) {
            _hookTempoRecompute();
            applyTempoToStats();
            startRespawnAccel();
            liveRefresh();
            let parts = [];
            if (t.aspd != null) parts.push(`攻擊間隔 ${t.aspd}秒`);
            if (t.castLock != null) parts.push(`施法冷卻 ${t.castLock}tick`);
            if (t.hitstun != null) parts.push(`硬直 ${t.hitstun}tick`);
            if (t.fastRespawn) parts.push('怪物立即重生');
            alert(`⚡ 戰鬥節奏已【開啟】！\n${parts.length ? parts.join('、') : '（未設定任何項目）'}\n\n⚠ 下次進遊戲後請再執行一次修改器，此設定才會持續生效。`);
        } else {
            stopRespawnAccel();
            liveRefresh();   // 重算恢復原值
            alert("⚡ 戰鬥節奏已【關閉】，恢復遊戲原本數值。");
        }
        syncTempoUI();
    };
    document.getElementById('btn-tempo-preset').onclick = function () {
        // 一鍵極速：攻擊間隔0.1秒、施法0、硬直0、怪物立即重生
        document.getElementById('tempo-aspd').value = '0.1';
        document.getElementById('tempo-cast').value = '0';
        document.getElementById('tempo-stun').value = '0';
        document.getElementById('tempo-respawn').checked = true;
        alert("🚀 已填入極速數值，按「套用」開啟生效。");
    };
    syncTempoUI();

    // 🤝 傭兵上限
    const syncAllyCapUI = () => {
        const v = loadAllyCap();
        let inp = document.getElementById('ally-cap'), st = document.getElementById('ally-cap-state');
        if (inp && v != null) inp.value = v;
        if (st) { let on = (v != null); st.textContent = on ? ('開啟 ✅（' + v + '名）') : '關閉'; st.parentElement.style.background = on ? '#0369a1' : '#0284c7'; }
    };
    document.getElementById('btn-ally-cap').onclick = function () {
        const on = (loadAllyCap() != null);
        if (on) {
            try { localStorage.removeItem(ALLYCAP_KEY); } catch (e) {}
            restoreAllyCap();
            alert("🤝 傭兵上限已【關閉】，恢復遊戲原本 3 名。");
        } else {
            let n = Math.max(1, Math.min(99, parseInt(document.getElementById('ally-cap').value) || 3));
            try { localStorage.setItem(ALLYCAP_KEY, String(n)); } catch (e) {}
            applyAllyCap(n);
            alert(`🤝 傭兵上限已【開啟】！\n同時上場人數上限改為 ${n} 名。\n（到招募 NPC 招募即可帶更多；已在場的不受影響）\n\n⚠ 下次進遊戲後請再執行一次修改器，此設定才會持續生效。`);
        }
        syncAllyCapUI();
    };
    syncAllyCapUI();

    // 💜 迷魅術可迷魅 BOSS
    const syncCharmBossUI = () => {
        let el = document.getElementById('charm-boss-state');
        if (el) { let on = isCharmBossOn(); el.textContent = on ? '開啟 ✅' : '關閉'; el.parentElement.style.background = on ? '#7e22ce' : '#9333ea'; }
    };
    document.getElementById('btn-charm-boss').onclick = function () {
        let on = isCharmBossOn();
        if (on) {
            try { localStorage.setItem(CHARM_KEY, '0'); } catch (e) {}
            restoreCharmBoss();
            alert("💜 迷魅術可迷魅BOSS 已【關閉】，恢復原本無法迷魅BOSS。");
        } else {
            try { localStorage.setItem(CHARM_KEY, '1'); } catch (e) {}
            applyCharmBoss();
            let ok = window._charmBossHooked === true;
            alert(ok
                ? "💜 迷魅術可迷魅BOSS 已【開啟】！\n對 BOSS 施放迷魅術將 100% 成功，變成你的召喚物（沿用 BOSS 自身的攻擊數值，會非常強）。\n\n用法：選定 BOSS 為目標 → 施放迷魅術。\n\n⚠ 下次進遊戲後請再執行一次修改器，此功能才會持續生效。"
                : "⚠ 開關已記錄，但 hook 尚未掛上（可能遊戲尚未載入完成）。\n請確認已在遊戲畫面中執行修改器，或重新整理遊戲後再執行一次。");
        }
        syncCharmBossUI();
    };
    syncCharmBossUI();

    // 🔮 迷魅怪繼承魔法
    const syncCharmMagicUI = () => {
        let el = document.getElementById('charm-magic-state');
        if (el) { let on = isCharmMagicOn(); el.textContent = on ? '開啟 ✅' : '關閉'; el.parentElement.style.background = on ? '#6d28d9' : '#7c3aed'; }
    };
    document.getElementById('btn-charm-magic').onclick = function () {
        let cfg = loadCharmMag();
        cfg.on = !cfg.on;
        saveCharmMag(cfg);
        const hasCharm = !!(player.charmed);
        const hasSnap = !!(player.charmed && player.charmed._magProc);
        alert(cfg.on
            ? ("🔮 迷魅怪繼承魔法 已【開啟】！\n被迷魅的怪會用自己最強的傷害型魔法攻擊敵人。\n" +
               (hasCharm ? (hasSnap ? "目前的迷魅怪已可施法。" : "⚠ 目前迷魅怪是在開啟前抓的（或該怪無傷害魔法）→ 請重新迷魅一次。") : "目前沒有迷魅怪，去迷魅一隻會放魔法的怪吧。") +
               "\n\n⚠ 下次進遊戲後請再執行一次修改器，此設定才會持續生效。")
            : "🔮 迷魅怪繼承魔法 已【關閉】，迷魅怪恢復只用普通攻擊。");
        syncCharmMagicUI();
    };
    syncCharmMagicUI();

    // 🐉 召喚指定 BOSS
    (function initSummonBossUI() {
        let sel = document.getElementById('summon-boss-sel');
        if (sel) {
            // b = [名稱, 等級, d0, d1, 攻速, 屬性]
            sel.innerHTML = SUMMON_BOSSES.map((b, i) => `<option value="${i}">Lv${b[1]} ${b[0]}（${b[2]}D${b[3]}）</option>`).join('');
        }
        const cfg = loadSummonBoss();
        if (sel && cfg.idx != null) sel.value = cfg.idx;
        let mEl = document.getElementById('summon-boss-mult');
        if (mEl && cfg.mult != null) mEl.value = cfg.mult;
    })();
    const syncSummonBossUI = () => {
        let el = document.getElementById('summon-boss-state');
        if (el) { let on = loadSummonBoss().on; el.textContent = on ? '開啟 ✅' : '關閉'; el.parentElement.style.background = on ? '#9d174d' : '#db2777'; }
    };
    document.getElementById('btn-summon-boss').onclick = function () {
        let cfg = loadSummonBoss();
        cfg.idx = parseInt(document.getElementById('summon-boss-sel').value) || 0;
        cfg.mult = Math.max(0.1, Number(document.getElementById('summon-boss-mult').value) || 1);
        cfg.on = !cfg.on;
        saveSummonBoss(cfg);
        if (cfg.on) {
            applySummonBoss();   // 免 MP 重召目前召喚物·hook 立即套用
            const b = SUMMON_BOSSES[cfg.idx];
            const mean = Math.round(b[2] * (b[3] + 1) / 2 * cfg.mult);   // 換算後每擊平均傷害
            const bhp = _bossHpFor(b[0]);
            alert(`🐉 召喚指定BOSS 已【開啟】！\n召喚術／強力屬性精靈（僅玩家）召出的召喚物將變成：\n「${b[0]}」（每擊約 ${mean} 傷害·攻速 ${b[4]}s·倍率×${cfg.mult}${bhp > 0 ? '·血量 ' + bhp : ''}）\n目前在場的召喚物已立即重召生效。\n\n⚠ 下次進遊戲後請再執行一次修改器，此功能才會持續生效。`);
        } else {
            restoreSummonBoss();   // 重召還原原本種類/數值
            alert("🐉 召喚指定BOSS 已【關閉】，召喚物已重召回原本種類與數值。");
        }
        syncSummonBossUI();
    };
    syncSummonBossUI();

    // 🛡️ 召喚物不死
    const syncSummonInvincUI = () => {
        let el = document.getElementById('summon-invinc-state');
        if (el) { let on = loadInvinc().on; el.textContent = on ? '開啟 ✅' : '關閉'; el.parentElement.style.background = on ? '#0f766e' : '#0d9488'; }
    };
    document.getElementById('btn-summon-invinc').onclick = function () {
        let cfg = loadInvinc();
        cfg.on = !cfg.on;
        saveInvinc(cfg);
        alert(cfg.on
            ? "🛡️ 召喚物不死 已【開啟】！\n召喚術／造屍術／屬性精靈的召喚物完全免傷、不會倒地。\n\n⚠ 下次進遊戲後請再執行一次修改器，此功能才會持續生效。"
            : "🛡️ 召喚物不死 已【關閉】，召喚物恢復正常受傷。");
        syncSummonInvincUI();
    };
    syncSummonInvincUI();

    // ⚡ 召喚/迷魅 命中+攻速強化
    (function initSCBuffUI() {
        const cfg = loadSCBuff();
        const h = document.getElementById('sc-buff-hit');
        const a = document.getElementById('sc-buff-aspd');
        if (h && cfg.hitAdd != null) h.value = cfg.hitAdd;
        if (a && cfg.aspdMult != null) a.value = cfg.aspdMult;
    })();
    const syncSCBuffUI = () => {
        let el = document.getElementById('sc-buff-state');
        if (el) { let on = loadSCBuff().on; el.textContent = on ? '開啟 ✅' : '關閉'; el.parentElement.style.background = on ? '#0e7490' : '#0891b2'; }
    };
    document.getElementById('btn-sc-buff').onclick = function () {
        let cfg = loadSCBuff();
        cfg.hitAdd = Number(document.getElementById('sc-buff-hit').value) || 0;
        cfg.aspdMult = Math.max(0.1, Math.min(1, Number(document.getElementById('sc-buff-aspd').value) || 1));
        cfg.on = !cfg.on;
        saveSCBuff(cfg);
        if (cfg.on) reSummonV2();   // 立即重召讓新攻速生效（迷魅怪下個 tick 自動吃）
        alert(cfg.on
            ? `⚡ 命中+攻速強化 已【開啟】！\n命中 +${cfg.hitAdd}、攻速 ×${cfg.aspdMult}（越小越快）。\n作用於召喚術／造屍術／屬性精靈與迷魅怪。\n\n⚠ 下次進遊戲後請再執行一次修改器，此設定才會持續生效。`
            : "⚡ 命中+攻速強化 已【關閉】，恢復原本命中與攻速。");
        syncSCBuffUI();
    };
    syncSCBuffUI();

    // 🔧 職業中文名／技能需求欄位字首對照（原本引用卻從未定義的既有 bug，現在補上）
    const CLS_NAME = { knight: '騎士', mage: '法師', elf: '妖精', dark: '黑暗妖精', illusion: '幻術士', dragon: '龍騎士', warrior: '戰士', royal: '王族' };
    const CLS_REQ = { knight: 'reqK', mage: 'reqM', elf: 'reqE', dark: 'reqDk', illusion: 'reqI', dragon: 'reqD', warrior: 'reqW', royal: 'reqRoy' };

    function refreshClsInfo() {
        let el = document.getElementById('mod-cls-info');
        if (!el) return;
        let cls = player.cls || '未選擇';
        let cnt = (player.skills && player.skills.length) || 0;
        el.innerText = `（目前職業：${CLS_NAME[player.cls] || cls}，已學 ${cnt} 個）`;
    }
    function learnSkills(filterByClass) {
        if (!DB.skills) { alert("❌ 此版本找不到技能資料(DB.skills)。"); return; }
        if (!Array.isArray(player.skills)) player.skills = [];
        let reqF = CLS_REQ[player.cls];
        if (filterByClass && !reqF) { alert("❌ 無法判斷目前職業，請改用「學會全部技能」。"); return; }
        let added = 0;
        for (let id in DB.skills) {
            if (filterByClass && DB.skills[id][reqF] == null) continue;   // 該職業不可學
            if (!player.skills.includes(id)) { player.skills.push(id); added++; }
        }
        liveRefresh(); refreshClsInfo();
        alert(`🎓 已學會 ${added} 個技能（${filterByClass ? CLS_NAME[player.cls] + '本職' : '全部'}）。`);
    }
    document.getElementById('btn-learn-class').onclick = function () { learnSkills(true); };
    document.getElementById('btn-learn-all').onclick = function () { learnSkills(false); };
    document.getElementById('btn-clear-skills').onclick = function () {
        if (!confirm("確定清空所有已學技能？")) return;
        player.skills = []; liveRefresh(); refreshClsInfo();
    };
    // 🧝 妖精全屬性魔法開關
    const syncElfEleBtn = () => {
        let el = document.getElementById('elf-allele-state');
        if (el) { let on = isElfEleUnlocked(); el.textContent = on ? '開啟 ✅' : '關閉'; el.parentElement.style.background = on ? '#047857' : '#059669'; }
    };
    document.getElementById('btn-elf-allele').onclick = function () {
        let on = isElfEleUnlocked();
        if (on) {
            try { localStorage.setItem(ELF_ELE_KEY, '0'); } catch (e) {}
            restoreElfAllEle();
            liveRefresh();
            alert("🧝 妖精全屬性魔法已【關閉】，恢復原本屬性限制。");
        } else {
            try { localStorage.setItem(ELF_ELE_KEY, '1'); } catch (e) {}
            let n = applyElfAllEle();
            liveRefresh();
            alert(`🧝 妖精全屬性魔法已【開啟】！\n已解除 ${n} 個屬性魔法的「一生一屬性」限制，技能列表已即時刷新。\n\n所有屬性魔法（火/水/地/風）現在只要等級達標即可使用，不再受單一屬性綁定。\n\n⚠ 下次進遊戲後請再執行一次修改器，此解鎖才會持續生效。`);
        }
        syncElfEleBtn();
    };
    syncElfEleBtn();
    refreshClsInfo();

    // ===== 9b. 自創攻擊魔法：新增並學會（type:'atk'，走 castSkillInner 原生一般傷害/AOE/異常/吸血路徑，不動核心檔案）=====
    const CLS_REQ_SKILL = { knight: 'reqK', mage: 'reqM', elf: 'reqE', dark: 'reqD', illusion: 'reqI', dragon: 'reqDk', warrior: 'reqW', royal: 'reqRoy' };   // 對照 js/01 skillReqLv 的真實欄位（dark用reqD、dragon用reqDk，兩者容易搞反）
    document.getElementById('btn-csk-create').onclick = function () {
        let name = (document.getElementById('csk-name').value || '').trim();
        if (!name) { alert('❌ 請先輸入技能名稱。'); return; }
        if (typeof DB === 'undefined' || !DB.skills) { alert('❌ 找不到遊戲技能資料庫。'); return; }
        let mp = Math.max(0, parseInt(document.getElementById('csk-mp').value, 10) || 0);
        let tier = Math.max(1, Math.min(10, parseInt(document.getElementById('csk-tier').value, 10) || 1));
        let diceN = Math.max(1, parseInt(document.getElementById('csk-dice-n').value, 10) || 1);
        let diceS = Math.max(1, parseInt(document.getElementById('csk-dice-s').value, 10) || 1);
        let ele = document.getElementById('csk-ele').value || 'none';
        let target = document.getElementById('csk-target').value;
        let animSrc = document.getElementById('csk-anim').value;
        let stKind = document.getElementById('csk-status-kind').value;
        let stDur = Math.max(1, parseInt(document.getElementById('csk-status-dur').value, 10) || 6);
        let lifesteal = !!document.getElementById('csk-lifesteal').checked;

        let id = 'sk_custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        let skDef = { n: name, type: 'atk', mp: mp, tier: tier, dmgDice: [diceN, diceS], ele: ele };
        if (target === 'all') skDef.target = 'all';
        if (stKind) skDef.status = { kind: stKind, dur: stDur };
        if (lifesteal) skDef.lifesteal = true;
        if (animSrc) skDef.__animSrc = animSrc;   // 只是備忘用（下次重跑修改器時拿來重新註冊 SPELL_FX 別名），遊戲引擎不會讀這個欄位
        let reqF = CLS_REQ_SKILL[player.cls] || 'reqE';
        skDef[reqF] = 1;   // 等級需求設1：一律可選，不受目前等級限制

        DB.skills[id] = skDef;
        // 🎬 借用現有動畫：SPELL_FX 是用「技能顯示名稱」當 key 查表，自訂名稱本來查不到，未註冊只是靜默不播動畫（不是錯誤來源）；
        //   這裡直接複製一份參照到 SPELL_FX[自訂名稱]，指向同一組已存在的素材設定，讓施法時能正確播出動畫。
        if (animSrc && typeof SPELL_FX !== 'undefined' && SPELL_FX[animSrc]) SPELL_FX[name] = SPELL_FX[animSrc];
        if (!player.skills) player.skills = [];
        if (!player.skills.includes(id)) player.skills.push(id);

        let all = loadCustomSkillDefs(); all[id] = skDef; saveCustomSkillDefs(all);   // 存一份供下次重跑修改器自動還原

        if (hasFn('renderSkillSelects')) renderSkillSelects();
        liveRefresh();
        refreshCskDelSelect();
        alert(`🔮 已新增自訂攻擊魔法「${name}」，並已加入已學技能！\n可以到「自動施放設定」的「攻擊技能」下拉選單挑選了（如果沒馬上出現，切一下分頁面板再切回即可刷新選單）。`);
    };

    // ===== 9c. 自創攻擊魔法：刪除（同時清 DB.skills、player.skills、localStorage 註冊表，三邊都清乾淨才不會變孤兒 id）=====
    function refreshCskDelSelect() {
        let sel = document.getElementById('csk-del-sel');
        if (!sel) return;
        let all = loadCustomSkillDefs();
        let ids = Object.keys(all);
        sel.innerHTML = ids.length
            ? ids.map(id => `<option value="${id}">${(all[id] && all[id].n) || id}</option>`).join('')
            : '<option value="">（沒有自訂魔法）</option>';
    }
    document.getElementById('btn-csk-delete').onclick = function () {
        let sel = document.getElementById('csk-del-sel');
        let id = sel && sel.value;
        if (!id) { alert('❌ 沒有可刪除的自訂魔法。'); return; }
        let all = loadCustomSkillDefs();
        let name = (all[id] && all[id].n) || id;
        if (!confirm(`確定要刪除自訂魔法「${name}」嗎？已學會的角色也會一併移除這個技能。`)) return;
        delete all[id];
        saveCustomSkillDefs(all);
        if (typeof DB !== 'undefined' && DB.skills) delete DB.skills[id];
        if (typeof SPELL_FX !== 'undefined') delete SPELL_FX[name];   // 🎬 順手清掉借用的動畫別名，避免留著一個指向已刪技能名稱的孤兒項
        if (player.skills) player.skills = player.skills.filter(s => s !== id);
        // 不用另外清 player 的自動施放欄位：這個選擇本來就只活在 DOM 的 select 裡（見 js/10 renderSkillSelects 的 prevAtk 還原邏輯——
        // 舊選項在重建清單裡已經不存在時，它本來就不會被還原回去，自然掉回「無」，不用我們手動處理）。
        if (hasFn('renderSkillSelects')) renderSkillSelects();
        liveRefresh();
        refreshCskDelSelect();
        alert(`🗑️ 已刪除自訂魔法「${name}」。`);
    };
    refreshCskDelSelect();

    // ===== 10b. 寵物種類 / 個別裝備即時修改（讀寫共用寵物保管桶 fb5_pet_roster，走遊戲原生 petRosterSave 合併寫入）=====
    function petModList() { return (hasFn('petRoster')) ? petRoster() : []; }
    function petModFindByUid(uidv) { return petModList().find(p => p && p.uid === uidv); }
    function petModDisplayName(p) {
        try { return hasFn('petDisplayName') ? petDisplayName(p) : p.form; } catch (e) { return p.form; }
    }
    function petModStatusLabel(p) {
        if (!p.outOwner) return '保管中';
        try {
            let mine = hasFn('_petCurrentOwnerKey') ? _petCurrentOwnerKey() : null;
            return (mine && String(p.outOwner) === mine) ? '出戰中(本角色)' : '出戰中(其他角色)';
        } catch (e) { return '出戰中'; }
    }
    function petModRefreshInfo() {
        let sel = document.getElementById('pet-sel');
        let info = document.getElementById('pet-info');
        if (!sel || !info) return;
        let p = petModFindByUid(sel.value);
        if (!p) { info.innerHTML = '（尚未選擇寵物）'; return; }
        let wpnG = p.eq && p.eq.wpn, armG = p.eq && p.eq.arm;
        let wpnName = (wpnG && DB.items[wpnG.id]) ? DB.items[wpnG.id].n + ((wpnG.en || 0) > 0 ? '+' + wpnG.en : '') : '（無）';
        let armName = (armG && DB.items[armG.id]) ? DB.items[armG.id].n + ((armG.en || 0) > 0 ? '+' + armG.en : '') : '（無）';
        info.innerHTML = `目前種類：<b style="color:#fde68a;">${p.form}</b>　Lv.${p.lv || 1}　HP:${p.hp}/${p.mhp}　MP:${p.mp}/${p.mmp}　［${petModStatusLabel(p)}］<br>寵物武器：<b style="color:#fca5a5;">${wpnName}</b>　寵物防具：<b style="color:#93c5fd;">${armName}</b>`;
    }
    function petModRefreshSelect() {
        let sel = document.getElementById('pet-sel');
        if (!sel) return;
        let keep = sel.value;
        let list = petModList();
        sel.innerHTML = list.length
            ? list.map(p => `<option value="${p.uid}">${petModDisplayName(p)}　Lv.${p.lv || 1}　[${petModStatusLabel(p)}]</option>`).join('')
            : '<option value="">（目前沒有任何寵物，請先捕捉一隻）</option>';
        if (keep && list.some(p => p.uid === keep)) sel.value = keep;
        petModRefreshInfo();
    }
    document.getElementById('pet-sel').onchange = petModRefreshInfo;
    document.getElementById('btn-pet-refresh').onclick = petModRefreshSelect;
    (function initPetFormSelect() {
        let sel = document.getElementById('pet-form-sel');
        if (!sel || typeof PET_BOOK === 'undefined') { if (sel) sel.innerHTML = '<option value="">（此版本找不到 PET_BOOK 寵物資料）</option>'; return; }
        let kindLabel = (typeof PET_KIND_LABEL === 'object' && PET_KIND_LABEL) || {};
        sel.innerHTML = Object.keys(PET_BOOK).map(name => {
            let def = PET_BOOK[name];
            return `<option value="${name}">${name}${def ? '（' + (kindLabel[def.kind] || def.kind) + (def.tier ? '·T' + def.tier : '') + '）' : ''}</option>`;
        }).join('');
    })();
    (function initPetGearSelects() {
        let wSel = document.getElementById('pet-wpn-sel');
        let aSel = document.getElementById('pet-arm-sel');
        if (!wSel || !aSel) return;
        let wOpts = [], aOpts = [];
        for (let id in DB.items) {
            let d = DB.items[id];
            if (!d) continue;
            if (d.slot === 'petwpn') wOpts.push([id, d.n || id]);
            else if (d.slot === 'petarm') aOpts.push([id, d.n || id]);
        }
        wOpts.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
        aOpts.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
        wSel.innerHTML = wOpts.length ? wOpts.map(([id, n]) => `<option value="${id}">${n}</option>`).join('') : '<option value="">（此版本無寵物武器道具）</option>';
        aSel.innerHTML = aOpts.length ? aOpts.map(([id, n]) => `<option value="${id}">${n}</option>`).join('') : '<option value="">（此版本無寵物防具道具）</option>';
    })();
    function petModPersist() {   // 統一寫回：優先走遊戲原生合併寫入，缺函式才退回一般存檔
        if (hasFn('petMarkDirty')) { try { petMarkDirty(); } catch (e) {} }
        if (hasFn('petRosterSave')) { try { return !!petRosterSave(); } catch (e) { return false; } }
        return doSave();
    }
    function petModBumpEqV(p) {
        try { p.eqV = hasFn('_petNowStamp') ? _petNowStamp() : Date.now(); } catch (e) { p.eqV = Date.now(); }
    }
    function petModAfterWrite() {
        liveRefresh();
        try { if (hasFn('renderSquadPanel')) renderSquadPanel(); } catch (e) {}
        try { let _d = document.getElementById('interaction-content'); if (_d && _d.querySelector('[data-petui]') && hasFn('renderPetStorageNPC')) renderPetStorageNPC(_d); } catch (e) {}
        petModRefreshSelect();
    }
    document.getElementById('btn-pet-form').onclick = function () {
        let p = petModFindByUid(document.getElementById('pet-sel').value);
        if (!p) { alert('❌ 請先選擇一隻寵物。'); return; }
        let newForm = document.getElementById('pet-form-sel').value;
        if (!newForm || typeof PET_BOOK === 'undefined' || !PET_BOOK[newForm]) { alert('❌ 找不到此版本的寵物種類資料。'); return; }
        if (newForm === p.form) { alert('該寵物已經是「' + newForm + '」了。'); return; }
        let oldForm = p.form, oldMhp = p.mhp, oldMmp = p.mmp, oldHp = p.hp, oldMp = p.mp;
        p.form = newForm;
        if (hasFn('petNewInstance')) {
            try {
                let fresh = petNewInstance(newForm, p.lv || 1);
                if (fresh) {
                    p.mhp = fresh.mhp; p.mmp = fresh.mmp;
                    p.hp = Math.max(1, Math.min(p.hp || p.mhp, p.mhp));
                    p.mp = Math.max(0, Math.min(p.mp || p.mmp, p.mmp));
                }
            } catch (e) {}
        }
        if (!petModPersist()) { p.form = oldForm; p.mhp = oldMhp; p.mmp = oldMmp; p.hp = oldHp; p.mp = oldMp; alert('❌ 寫入寵物保管失敗，已還原。'); return; }
        petModAfterWrite();
        alert(`🐾 已將「${oldForm}」變更為「${newForm}」！（等級/經驗保留，血量/魔力已依新種類換算）`);
    };
    function petModApplyGear(key, itemSelId, enInputId) {
        let p = petModFindByUid(document.getElementById('pet-sel').value);
        if (!p) { alert('❌ 請先選擇一隻寵物。'); return; }
        let itemId = document.getElementById(itemSelId).value;
        if (!itemId || !DB.items[itemId]) { alert('❌ 請選擇有效的裝備。'); return; }
        let en = Math.max(0, Math.min(9, parseInt(document.getElementById(enInputId).value, 10) || 0));
        let oldEq = p.eq ? JSON.parse(JSON.stringify(p.eq)) : null, oldEqV = p.eqV;
        p.eq = p.eq || {};
        p.eq[key] = { id: itemId, uid: (hasFn('uid') ? uid() : 'pg' + Date.now() + Math.random().toString(36).slice(2, 6)), en: en };
        petModBumpEqV(p);
        if (!petModPersist()) { p.eq = oldEq; p.eqV = oldEqV; alert('❌ 寫入失敗，已還原。'); return; }
        petModAfterWrite();
        alert(`🐾 已為「${petModDisplayName(p)}」裝上 ${DB.items[itemId].n}${en > 0 ? '+' + en : ''}！`);
    }
    function petModUnequipGear(key) {
        let p = petModFindByUid(document.getElementById('pet-sel').value);
        if (!p) { alert('❌ 請先選擇一隻寵物。'); return; }
        if (!p.eq || !p.eq[key]) { alert('這隻寵物目前沒有裝備該部位。'); return; }
        let oldEq = JSON.parse(JSON.stringify(p.eq)), oldEqV = p.eqV;
        delete p.eq[key];
        if (!p.eq.wpn && !p.eq.arm) delete p.eq;
        petModBumpEqV(p);
        if (!petModPersist()) { p.eq = oldEq; p.eqV = oldEqV; alert('❌ 寫入失敗，已還原。'); return; }
        petModAfterWrite();
        alert('🐾 已卸下裝備。');
    }
    document.getElementById('btn-pet-wpn').onclick = function () { petModApplyGear('wpn', 'pet-wpn-sel', 'pet-wpn-en'); };
    document.getElementById('btn-pet-arm').onclick = function () { petModApplyGear('arm', 'pet-arm-sel', 'pet-arm-en'); };
    document.getElementById('btn-pet-wpn-off').onclick = function () { petModUnequipGear('wpn'); };
    document.getElementById('btn-pet-arm-off').onclick = function () { petModUnequipGear('arm'); };
    petModRefreshSelect();

    // ===== 11. 寫入核心數值（共用：金錢/等級/經驗/點數，不含六圍）=====
    function applyCore() {
        player.gold = parseInt(document.getElementById('mod-gold').value) || 0;
        player.lv = parseInt(document.getElementById('mod-lv').value) || 1;
        player.exp = parseInt(document.getElementById('mod-exp').value) || 0;
        player.bonus = parseInt(document.getElementById('mod-bonus').value) || 0;
    }

    // 🧬 套用六圍改動（獨立按鈕，仿照裝備區塊的 btn-apply-eq：只在按下時才寫入，不會被其他按鈕連帶觸發）
    function applyStats() {
        // 六圍：把目標有效值回推成 alloc（有效 = base + alloc + panacea）
        player.alloc = player.alloc || { str:0,dex:0,con:0,int:0,wis:0,cha:0 };
        STATS.forEach(s => {
            let target = parseInt(document.getElementById('mod-' + s.k).value);
            if (isNaN(target)) return;
            let baseVal = (player.base?.[s.k] || 0) + (player.panacea?.[s.k] || 0);
            player.alloc[s.k] = Math.max(0, target - baseVal);
        });
        liveRefresh(); updateInvPanel();
        // 同步輸入框顯示為實際生效值
        STATS.forEach(s => { let el = document.getElementById('mod-' + s.k); if (el) el.value = effStat(s.k); });
    }
    document.getElementById('btn-apply-stats').onclick = function () {
        applyStats();
        alert("🧬 已套用六圍改動（尚未寫入存檔，建議再按「套用並存檔」固化；此按鈕只改六圍，不影響其他欄位）。");
    };

    // ⚡ 即時套用（不重整；六圍需另按「套用六圍改動」，不會在這裡連帶套用）
    document.getElementById('btn-apply-live').onclick = function () {
        applyCore(); liveRefresh(); updateInvPanel();
        alert("⚡ 已即時套用（尚未寫入存檔，建議再按「套用並存檔」固化）。");
    };

    // 💾 套用並存檔重整（六圍需另按「套用六圍改動」，不會在這裡連帶套用）
    document.getElementById('btn-save-all').onclick = function () {
        applyCore(); liveRefresh();
        doSave();
        alert("💾 已套用並寫入存檔位 " + getSlot() + "！即將重新整理加載。");
        location.reload();
    };

    updateInvPanel();
    renderEquipPanel();
})();