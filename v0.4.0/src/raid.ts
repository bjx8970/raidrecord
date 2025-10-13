import { ItemHelper } from "@spt/helpers/ItemHelper";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { IEftStats, IInventory } from "@spt/models/eft/common/tables/IBotBase";
import { IItem } from "@spt/models/eft/common/tables/IItem"
import { BaseClasses } from "@spt/models/enums/BaseClasses";
import { error, info } from "node:console";

// 常量配置
const itemUsedJudgeError: number = 1e-6;

// 接口
export interface IModConfig {
    RaidRecordClearAll: boolean, // 是否清理所有突袭缓存与突袭记录(慎用!!!)
    RaidCacheClearAll: boolean, // 是否清理所有突袭缓存
    LogVictims: boolean, // 日志是否输出对局中的击杀信息
    // 你希望输出对局记录的日志的颜色
    LogRaidColor: string
}

export interface IRaidResultsData {
    result: string, // 结果字符串
    killerId: string | null, // 击杀玩家的id
    killerAid: string | null, // 击杀玩家的账号id
    exitName: string, // 撤离点字符串
    inSession: boolean,
    favorite: boolean,
    playTime: number // 本局游玩时间
}

// 对局的详细信息
export interface IRaidInfo {
    serverId: string, // 对局ID
    playerId: string, // 参与的玩家ID
    createTime: number,
    state: string, // 未归档 | 已归档 | 中途退出 | 推测对局
    // 下面两个属性都是 { 物品实例id -> 物品实例 }
    raidInventoryBegin: Record<string, IItem>, // 入局库存
    raidInventoryEnd: Record<string, IItem>, // 撤离后的库存
    addition: string[], // 新获得的物品
    remove: string[], // 损失的物品
    used: string[], // 对局中使用了的物品
    entryValue: number, // 入场价值
    equipmentValue: number, // 装备价值
    securedValue: number, // 安全箱物品总价值
    grossProfit: number, // 毛收益
    combatLosses: number, // 战损
    eftStats: IEftStats // 战局状态结果(包括详细击杀数据)
    results: IRaidResultsData  // 突袭实际结果
};

export function timeString(time: number): string {
    return `${Math.floor(time / 3600)}h ${Math.floor((time % 3600) / 60)}min ${time % 60}s`
}

/**
 * SPT的数据几乎不存在循环引用, 直接用JSON复制
 * @param obj 要被复制的物品
 * @returns 复制后的物品
 */
export function copy(obj: any): any {
    return JSON.parse(JSON.stringify(obj))
}

/**
 * 获取字典的子集
 * @param dict 原字典
 * @param keys 键的列表
 * @returns 
 */
export function pickDict<T>(
    dict: Record<string, T>, 
    keys: string[]
): Record<string, T> {
    const result = {} as Record<string, T>;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(dict, key)) {
            result[key] = dict[key];
        }
    }
    return result;
}

/**
 * 根据进入/离开突袭前后的仓库, 返回所有装备
 * @param inventoryPMCCurrent 
 * @param itemHelper 
 * @returns Record<string, IItem>
 */
export function loadInventoryInfo(inventoryPMCCurrent: IInventory, itemHelper: ItemHelper): Record<string, IItem> {
    let clone: Record<string, IItem> = {};

    if (!inventoryPMCCurrent) {
        console.warn('参数为空');
        return clone;
    }

    const postRaidInventoryItems = itemHelper.findAndReturnChildrenAsItems(
        inventoryPMCCurrent.items,
        inventoryPMCCurrent.equipment
    );
    
    for (const item of postRaidInventoryItems) {
        let cloneItem: IItem = copy(item);
        clone[item._id] = cloneItem;
    }

    return clone;
}

/**
 * 根据ID变换信息, 更新IRaidInfo(返回新对象)
 * 将更新raidInventoryBegin, raidInventoryEnd字典
 * 和addition, remove, used列表的与id有关字段
 * @param raidInfo 
 * @param replaceInfo { 旧ID -> 新ID }
 */
export function updateRaidInfoByReplaceIDs(raidInfo: IRaidInfo, replaceInfo: Record<string, string>): IRaidInfo {
    const clone = copy(raidInfo);

    for (const map of [clone.raidInventoryBegin, clone.raidInventoryEnd]) {
        if (!map) continue;
        for (const oldId in map) {
            const newId = replaceInfo[oldId];
            if (newId && oldId !== newId) {
                const item = map[oldId];
                item._id = newId;
                delete map[oldId];
                map[newId] = item;
            }
        }
    }

    const lists = [clone.addition, clone.remove, clone.used];
    for (const list of lists) {
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
            const newId = replaceInfo[list[i]];
            if (newId && list[i] !== newId) {
                list[i] = newId;
            }
        }
    }

    return clone;
}

/**
 * 根据物品upd参数修正价格倍率: 药品使用次数, 装备耐久, 钥匙使用次数等
 * @param item 
 * @param itemTemplates 通过DatabaseService.getTables().templates.items获取的映射
 * @returns 
 */
export function iitemQualityModify(item: IItem, itemHelper: ItemHelper): number {
    return itemHelper.getItemQualityModifier(item);
}

/**
 * 归档
 * @param raidInfo 
 * @param pmcData 
 * @param itemHelper 
 * @returns 
 */
export function archive2RaidInfo(raidInfo: IRaidInfo, pmcData: IPmcData, itemHelper: ItemHelper): IRaidInfo {
    if (!raidInfo || !pmcData || !pmcData.Stats || !pmcData.Stats.Eft || !itemHelper) {
        throw "参数错误: raidInfo, pmcData, itemHelper为空或部分属性为空"
        return;
    }
    let clone: IRaidInfo = copy(raidInfo);
    clone.addition = [];
    clone.remove = [];
    clone.used = [];
    for (let [itemId, item] of Object.entries(clone.raidInventoryBegin)) {
        if (!clone.raidInventoryEnd[itemId]) {
            clone.remove.push(itemId);
        } else {
            if (Math.abs(iitemQualityModify(clone.raidInventoryEnd[itemId], itemHelper) 
                - iitemQualityModify(clone.raidInventoryBegin[itemId], itemHelper)) < itemUsedJudgeError) {
                    continue;
            }
            clone.used.push(itemId);
        }
    }
    for (let [itemId, item] of Object.entries(clone.raidInventoryEnd)) {
        if (!clone.raidInventoryBegin[itemId]) {
            clone.addition.push(itemId);
        }
    }
    let grossProfit: number = 0;
    let combatLosses: number = 0;

    grossProfit += calculateInventoryValue(clone.raidInventoryEnd, clone.addition, itemHelper)
    combatLosses += calculateInventoryValue(clone.raidInventoryBegin, clone.remove, itemHelper)

    for (const [itemId, item] of Object.entries(pickDict<IItem>(clone.raidInventoryBegin, clone.used))) {
        const oldValue = getItemValue(item, itemHelper);
        const newItem = clone.raidInventoryEnd[itemId]
        if (!newItem) { error(`使用过且没使用完的物品${itemId}(tpl=${item._tpl})不存在`); continue; }
        const newValue = getItemValue(newItem, itemHelper);

        const debug_item = itemHelper.getItem(item._tpl)[1];
        info(`DEBUG: 物品${debug_item._name}使用价值变化: ${oldValue} -> ${newValue}`)
        if (newValue > oldValue) {
            grossProfit += newValue - oldValue;
        } else {
            combatLosses += oldValue - newValue;
        }
    }
    clone.entryValue = calculateInventoryValue(clone.raidInventoryBegin, Object.keys(clone.raidInventoryBegin), itemHelper);
    clone.grossProfit = grossProfit || -1;
    clone.combatLosses = combatLosses || -1;
    clone.state = clone.state != "推测对局" ?  "已归档" : "推测对局";
    let result: IEftStats = copy(pmcData.Stats.Eft);
    // 移除目前不用的统计选项
    result.SessionCounters = null;
    result.OverallCounters = null;
    result.DroppedItems = null;
    // result.Aggressor = null; // 保留导致角色死亡的攻击者信息（可选）
    result.DamageHistory = null;
    clone.eftStats = result;
    return clone;
}

/**
 * 计算有效的物品数量
 * @param items 
 * @param itemHelper 
 * @returns 
 */
export function getValidItemCount(items: IItem[], itemHelper: ItemHelper): number {
    let count = 0;
    for (const item of items) {
        if (itemHelper.isValidItem(item._tpl) && item?.parentId != "68e2c9a23d4d3dc9e403545f") {
            count++;
        }
    }
    return count;
}

/**
 * 获取物资价格(排除默认物品栏的容器, 如安全箱)
 * @param item 
 * @param itemHelper 
 */
export function getItemValue(item: IItem, itemHelper: ItemHelper): number {
    /**
     * const defaultItemSlot = "55d7217a4bdc2d86028b456d";
     * const defaultItemSlotId = items.find(x => x._tpl == defaultItemSlot)?._id || "68e2c9a23d4d3dc9e403545f";
     */
    // 忽略默认物品栏
    if (item?.parentId == "68e2c9a23d4d3dc9e403545f") { return 0; }
    return Math.max(0, Math.abs(iitemQualityModify(item, itemHelper)) * itemHelper.getItemPrice(item._tpl));
}

/**
 * 获取物资列表内所有物资的总价值(排除默认物品栏的容器)
 * @param items 
 * @param itemHelper 
 * @returns 
 */
export function getItemsValueAll(items: IItem[], itemHelper: ItemHelper): number {
    const defaultItemSlot = "55d7217a4bdc2d86028b456d";
    const defaultItemSlotId = items.find(x => x._tpl == defaultItemSlot)?._id || "68e2c9a23d4d3dc9e403545f";
    let value: number = 0;
    for (let item of items.filter(x => x?.parentId != defaultItemSlotId)) {
        value += getItemValue(item, itemHelper);
    }
    return value;
}

/**
 * 计算库存inventory中所有id处于filter中物品价格
 * @param inventory 仓库 Record<string, IItem>
 * @param filter 匹配的id列表 string[]
 * @param itemHelper 
 * @returns 
 */
export function calculateInventoryValue(inventory: Record<string, IItem>, filter: string[], itemHelper: ItemHelper): number {
    return getItemsValueAll(
        Object.values(inventory).filter(x => filter.includes(x._id)), 
        itemHelper
    );
}

/**
 * 计算具有提供的任何基类的所有物品价值
 * @param items 
 * @param baseClasses 
 * @param itemHelper 
 * @returns 
 */
export function getItemsValueWithBaseClasses(items: IItem[], baseClasses: BaseClasses[], itemHelper: ItemHelper) {
    return getItemsValueAll(items.filter(x => itemHelper.isOfBaseclasses(x._tpl, baseClasses)), itemHelper);
}

/**
 * 获取物品列表中所有处于指定槽位下的所有物品
 * @param desiredContainerSlotId 所希望的容器槽ID
 * @param items 
 * @returns 
 */
export function getAllItemsInContainer(desiredContainerSlotId: string, items: IItem[]): IItem[] {
    const containerItems: IItem[] = [];
    const pushTag: Set<string> = new Set<string>();
    
    for (const item of items) {
        let currentItem = item;
        
        // 递归向上查找父级
        while (currentItem.parentId) {
            const parent = items.find(i => i._id === currentItem.parentId);
            if (!parent) break;
            
            if (parent.slotId === desiredContainerSlotId) {
                if (!pushTag.has(item._id)) {
                    containerItems.push(item);
                    pushTag.add(item._id)
                }

                break;
            }
            
            currentItem = parent;
        }
    }
    
    return containerItems;
}