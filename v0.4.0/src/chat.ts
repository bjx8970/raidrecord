import { IDialogueChatBot } from "@spt/helpers/Dialogue/IDialogueChatBot";
import { ISendMessageRequest } from "@spt/models/eft/dialog/ISendMessageRequest";
import { IUserDialogInfo } from "@spt/models/eft/profile/IUserDialogInfo";
import { MemberCategory } from "@spt/models/enums/MemberCategory";
import { DialogueController } from "@spt/controllers/DialogueController";
import { ISendMessageDetails } from "@spt/models/spt/dialog/ISendMessageDetails";
import { MailSendService } from "@spt/services/MailSendService";
import { MessageType } from "@spt/models/enums/MessageType";
import { FileSystem } from "@spt/utils/FileSystem";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { inject, injectable } from "tsyringe";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { ISearchFriendResponse } from "@spt/models/eft/profile/ISearchFriendResponse";
import { NotificationSendHelper } from "@spt/helpers/NotificationSendHelper";
import { HashUtil } from "@spt/utils/HashUtil";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { IAggressor, IVictim } from "@spt/models/eft/common/tables/IBotBase";
import { DatabaseService } from "@spt/services/DatabaseService";
import { roldNames } from "./lcoals";
import { DialogueHelper } from "@spt/helpers/DialogueHelper";
import { IDialogue } from "@spt/models/eft/profile/ISptProfile";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import path from "path";

import { jsonRaidRecordPath } from "./mod";
import { IItemArchive, IRaidInfoArchive, IRaidInfoServerArchiveData } from "./archive";
import { pickDict, timeString } from "./raid"
import { armorZone, extractionPointNames, mapNames, resultNames } from "./lcoals"

// 常量配置
const archiveCheckJudgeError: number = 1e-6;

// 命令参数
interface IParametrics {
    sessionId: string,
    managerChat: RaidRecordManagerChat,
    paras: Map<string, string>;
};

type ICommandCallback = (arg0: IParametrics) => string;

interface IParaInfo {
    paras: string[],
    types: Map<string, string>,
    descs: Map<string, string>,
    optional: Set<string>
}

/**
 * 空参数IParaInfo创建器
 * 协议:
 * - paras为空列表 []
 * - 其他参数为对应容器实例, 不应为null
 * @returns 
 */
const emptyIParaInfo: () => IParaInfo = () => { return {paras: [], types: new Map<string, string>(), descs: new Map<string, string>(), optional: new Set<string>()}}

/**
 * 初始化并获取IParametrics实例
 * @param sessionId 
 * @param managerChat 
 * @returns 
 */
const getIParametrics: (sessionId: string, managerChat: RaidRecordManagerChat) => IParametrics = (sessionId: string, managerChat: RaidRecordManagerChat) => { return { sessionId: sessionId, managerChat: managerChat, paras: new Map<string, string>()} }

interface ICommand {
    key: string,
    desc: string, // 包含命令介绍与参数提示
    paraInfo: IParaInfo, // 参数的解释说明信息(不参与验证)
    paras: IParametrics, // 实际参数
    callback: ICommandCallback
}

/**
 * 用所有空白字符（空格、制表符、换行符等）分隔命令字符串, 并过滤掉空字符串元素
 * @param cmd 
 * @returns 
 */
function splitCommand(cmd: string): string[] {
    return cmd.split(/\s+/).filter(Boolean);
}

function unionKey(keys: string[]): string {
    return keys.join('|')
}

/**
 * 根据IParaInfo属性更新一条命令使用指南, 追加到原有的desc后
 * @param icommand 
 */
function updateCommandDesc(icommand: ICommand): void {
    let desc = `${icommand.key}`;
    if (!icommand?.paraInfo || icommand.paraInfo.paras.length <= 0) {
        icommand.desc += desc;
        return;
    }
    for (const para of icommand.paraInfo.paras) {
        const _option = icommand.paraInfo.optional.has(para); // 是否可选
        const _type = icommand.paraInfo.types.get(para) || 'undefined';
        const _centerString = `${para}: ${_type}`;
        desc += ' ' + (_option ? `[${_centerString}]` : _centerString);
    }
    if (icommand.paraInfo.descs.size) {
        for (const para of icommand.paraInfo.paras) {
            if (icommand.paraInfo.descs.has(para)) {
                desc += `\n> ${para}: ${icommand.paraInfo.descs.get(para)}`
            }
        }
    }
    icommand.desc += desc;
}

/**
 * 参数信息构建器类
 */
class ParaInfoBuilder {
    private paraInfo: IParaInfo;

    constructor() {
        this.paraInfo = emptyIParaInfo();
    }

    addParam(name: string, type: string, desc: string): ParaInfoBuilder {
        this.paraInfo.paras.push(name);
        this.paraInfo.types.set(name, type);
        this.paraInfo.descs.set(name, desc);
        return this;
    }

    setOptional(param: string[]): ParaInfoBuilder {
        for (const para of param) {
            this.paraInfo.optional.add(para);
        }
        return this;
    }

    /**
     * 构建参数信息, 返回构建好的实例后重置自身的数据
     * @returns 
     */
    build(): IParaInfo {
        const info =  this.paraInfo;
        this.paraInfo = emptyIParaInfo();
        return info;
    }
}

// 客户端超过这个长度的字符串会被截断
const sendLimit: number = 491;

/**
 * 分隔要发送的字符串, 避免客户端无法完整显示
 * @param str 
 * @returns 
 */
function splitStringByNewlines(str: string): string[] {
    if (str.length <= sendLimit) {
        return [str];
    }

    // 用换行符分割
    const segments = str.split('\n');
    const result: string[] = [];

    let currentSegment = '';

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const potentialSegment = currentSegment ? currentSegment + '\n' + segment : segment;

        if (potentialSegment.length < sendLimit) {
            currentSegment = potentialSegment;
        } else {
            if (currentSegment) {
                result.push(currentSegment);
            }
            currentSegment = segment;
        }
    }

    if (currentSegment) {
        result.push(currentSegment);
    }

    return result;
}

@injectable()
export class RaidRecordManagerChat implements IDialogueChatBot {
    private mod_name: string = "突袭战绩记录";
    private cmdMap: Map<string, ICommand>; // { cmdId -> cmdInstance }
    protected raidInfoServerArchive: IRaidInfoServerArchiveData;
    protected paraInfoBuilder: ParaInfoBuilder;

    constructor(
        @inject("DialogueHelper") protected dialogueHelper: DialogueHelper,
        @inject("MailSendService") protected mailSendService: MailSendService,
        @inject("PrimaryLogger") protected logger: ILogger,
        @inject("HashUtil") protected hashUtil: HashUtil,
        @inject("ProfileHelper") protected profileHelper: ProfileHelper,
        @inject("DialogueController") protected dialogueController: DialogueController,
        @inject("NotificationSendHelper") protected notificationSendHelper: NotificationSendHelper,
        @inject("DatabaseService") protected databaseService: DatabaseService,
        @inject("ItemHelper") protected itemHelper: ItemHelper,
        @inject("FileSystem") protected fileSystem: FileSystem
    )
    {
        this.cmdMap = new Map<string, ICommand>();
        this.paraInfoBuilder = new ParaInfoBuilder();
        this.initCommands();
    }

    init(raidInfoServerArchive: IRaidInfoServerArchiveData) {
        this.raidInfoServerArchive = raidInfoServerArchive;
    }


    protected info(msg: string): void {
        if (this.logger) {
            this.logger.info(`[${this.mod_name}] ${msg}`);
        }
    }
    
    protected warn(msg: string): void {
        if (this.logger) {
            this.logger.warning(`[${this.mod_name}] ${msg}`);
        }
    }

    protected error(msg: string): void {
        if (this.logger) {
            this.logger.error(`[${this.mod_name}] ${msg}`);
        }
    }

    private initCommands(): void {
        const commands: ICommand[] = [
            {
                key: 'help',
                desc: `获取所有命令的帮助信息, 使用方式(中括号表示为可选参数): \n`,
                paraInfo: emptyIParaInfo(),
                paras: null,
                callback: this.getHelpCommand()
            },
            {
                key: 'list',
                desc: `获取自身所有符合条件的对局历史记录, 使用方式(中括号表示为可选参数): \n`,
                paraInfo: this.paraInfoBuilder
                    .addParam('limit', 'int', '每一页历史记录数量限制')
                    .addParam('page', 'int', '要查看的页码')
                    .setOptional(['limit', 'page'])
                    .build(),
                paras: null,
                callback: this.getListCommand()
            },
            {
                key: 'info',
                desc: `使用序号或serverId获取详细对局记录(至少需要一个参数), 使用方式(中括号表示为可选参数): \n`,
                paraInfo: this.paraInfoBuilder
                    .addParam('serverId', 'string', '对局ID')
                    .addParam('index', 'int', '对局索引')
                    .setOptional(['serverId', 'index'])
                    .build(),
                paras: null,
                callback: this.getInfoCommand()
            },
            {
                key: 'check',
                desc: `使用序号或serverId检查并重新计算收益和战损(至少需要一个参数), 使用方式(中括号表示为可选参数): \n`,
                paraInfo: this.paraInfoBuilder
                    .addParam('serverId', 'string', '对局ID')
                    .addParam('index', 'int', '对局索引')
                    .setOptional(['serverId', 'index'])
                    .build(),
                paras: null,
                callback: this.getCheckCommand()
            },
            {
                key: 'cls',
                desc: `清除聊天对话框历史记录, 使用方式(中括号表示为可选参数): \n`,
                paraInfo: emptyIParaInfo(),
                paras: null,
                callback: this.getClsCommand()
            }
        ]
        for (let command of commands) {
            updateCommandDesc(command);
            this.cmdMap.set(command.key, command);
        }
    }

    private handleCommand(command: string, sessionId: string): string {
        const data = splitCommand(command);
        if (data.length <= 0) {
            return '未输入任何命令';
        }
        if (!this.cmdMap.has(data[0])) {
            return `未知的命令: ${data[0]}, 请输入help查看可用指令`
        }
        const iCmd: ICommand = this.cmdMap.get(data[0]);
        iCmd.paras = getIParametrics(sessionId, this);

        let index = 1;
        while (index >= 1 && index < data.length) {
            if (data[index+1]) {
                iCmd.paras.paras.set(data[index], data[index+1]);
                index += 1;
            }
            index += 1;
        }
        const result: string = iCmd.callback(iCmd.paras);
        iCmd.paras.managerChat = null;
        iCmd.paras.paras.clear()
        iCmd.paras = null;
        return result;
    }

    getChatBot(): IUserDialogInfo {
        return {
            _id: "68e2d45e17ea301214c2596d",
            aid: 8100860,
            Info: {
                Level: 69,
                Side: "Usec",
                Nickname: "对局战绩管理",
                MemberCategory: MemberCategory.SHERPA,
                SelectedMemberCategory: MemberCategory.SHERPA
            }
        };
    }

    handleMessage(sessionId: string, request: ISendMessageRequest): string {
        try {
            this.sendAllMessage(sessionId, this.handleCommand(request.text, sessionId))
		} catch (e) {
			this.error(e.name);
			this.error(e.message);
			this.error(e.stack);
			this.sendMessage(sessionId, `指令处理失败: ${e.message}\n请检查你输入的指令: '${request.text}'`);
		}

		return request.dialogId;
    }

    public sendAllMessage(sessionId: string, str: string): void {
        let messages: string[] = splitStringByNewlines(str);
        if (messages.length == 0) { return; }
        if (messages.length == 1) { 
            setTimeout(() => { this.sendMessage(sessionId, messages[0]) }, 1000);
            return; 
        }
        let i = 0, len = messages.length;
        const loop = () => {
            this.sendMessage(sessionId, messages[i]);
            i++;
            if (i < len) setTimeout(loop, 1250);
        }
        setTimeout(() => { loop() }, 750);
    }
    
    public sendMessage(sessionId: string, msg: string): void {
        const details: ISendMessageDetails = {
			recipientId: sessionId,
			sender: MessageType.USER_MESSAGE,
			senderDetails: this.getChatBot(),
			messageText: msg,
		};
        this.mailSendService.sendMessageToPlayer(details);
    }

    private getPMCProfile(sessionId: string): string | null {
        const searchFriendResponse: ISearchFriendResponse = this.profileHelper.getChatRoomMemberFromSessionId(sessionId);
        const player_id: string = searchFriendResponse._id;
        return this.profileHelper.isPlayer(player_id) ? player_id : null;
    }

    private getHelpCommand(): ICommandCallback {
        return (arg0: IParametrics) => {
            const verify = this.verifyIParametrics(arg0);
            if (verify) { return verify; };

            let msg = '帮助信息(参数需要按键值对写, 例如"list index 1"; 中括号表示可选参数):';
            for (const cmd of this.cmdMap.values()) {
                msg += `\n - ${cmd.key}: ${cmd.desc}\n`
            }
            return msg;
        };
    }

    private getListCommand(): ICommandCallback {
        return (arg0: IParametrics) => {
            const verify = this.verifyIParametrics(arg0);
            if (verify) { return verify; };

            const records: IRaidInfoArchive[] = this.getArchiveListBySession(arg0.sessionId);
            let numberLimit: number = 0, page: number = 0, showServerId = false;
            try {
                numberLimit = parseInt(arg0.paras.get('limit') ?? "10");
                page = parseInt(arg0.paras.get('page') ?? "1");
            } catch (e) {
                return `参数解析时出现错误: ${e.message}`;
            }
            numberLimit = Math.min(20, Math.max(1, numberLimit));
            page = Math.max(1, page);

            const indexLeft = Math.max(numberLimit *  (page - 1), 0);
            const indexRight = Math.min(numberLimit * page, records.length);
            if (records.length <= 0) { return `您没有任何历史战绩, 请至少对局一次后再来查询吧` };
            const results: IRaidInfoArchive[] = [];
            for (let i = indexLeft; i < indexRight; i++) {
                results.push(records[i]);
            }
            if (results.length <= 0) { return `未查询到您第${indexLeft+1}到${indexRight}条历史战绩` };
            let msg = `历史战绩(共${results.length}/${records.length}条):\n - serverId                 序号 地图 入场总价值 带出收益 战损 游戏时间 结果\n`;
            let jump: number = 0;
            for (const i in results) {
                if (!results[i] || !results[i].serverId) { jump++; continue; }
                msg += ` - ${results[i].serverId} ${indexLeft+parseInt(i)} ${mapNames[results[i].serverId.substring(0, results[i].serverId.indexOf('.')).toLowerCase()]} ${results[i].entryValue} ${results[i].grossProfit} ${results[i].combatLosses} ${timeString(results[i].results.playTime)} ${resultNames[results[i].results.result] ?? results[i].results.result}\n`
            }
            if (jump) { msg += `跳过${jump}条无效数据`; }
            return msg;
        }
    }

    private getInfoCommand(): ICommandCallback {
        return (arg0: IParametrics) => {
            const verify = this.verifyIParametrics(arg0);
            if (verify) { return verify; };

            let serverId: string = null, index: number = -1;
            try {
                serverId = arg0.paras.get('serverId') ?? null;
                index = parseInt(arg0.paras.get('index') ?? "-1");
            } catch (e) {
                return `参数解析时出现错误: ${e.message}`;
            }

            if (serverId) {
                const records = this.getArchivesBySession(arg0.sessionId);
                const record = records[serverId];
                if (record) {
                    return this.getArchiveDetails(record);
                } else {
                    return `serverId为${serverId}的对局不存在, 请检查你的输入`;
                }
            } 
            if (index >= 0) {
                const records = this.getArchiveListBySession(arg0.sessionId);
                if (index >= records.length) { return `索引${index}超出范围: [0, ${records.length})` };
                return this.getArchiveDetails(records[index]);
            }
            return `请输入正确的serverId(当前: ${serverId})或index(当前: ${index})`;
        }
    }

    private getCheckCommand(): ICommandCallback {
        return (arg0: IParametrics) => {
            const verify = this.verifyIParametrics(arg0);
            if (verify) { return verify; };

            let serverId: string = null, index: number = -1;
            try {
                serverId = arg0.paras.get('serverId') ?? null;
                index = parseInt(arg0.paras.get('index') ?? "-1");
            } catch (e) {
                return `参数解析时出现错误: ${e.message}`;
            }

            if (serverId) {
                const records = this.getArchivesBySession(arg0.sessionId);
                const record = records[serverId];
                if (record) {
                    return this.checkArchive(record);
                } else {
                    return `serverId为${serverId}的对局不存在, 请检查你的输入`;
                }
            } 
            if (index >= 0) {
                const records = this.getArchiveListBySession(arg0.sessionId);
                if (index >= records.length) { return `索引${index}超出范围: [0, ${records.length})` };
                return this.checkArchive(records[index]);
            }
            return `请输入正确的serverId(当前: ${serverId})或index(当前: ${index})`;
        }
    }

    private getClsCommand(): ICommandCallback {
        return (arg0: IParametrics) => {
            const verify = this.verifyIParametrics(arg0);
            if (verify) { return verify; };

            const managerProfile = this.getChatBot();

            const dialogs: Record<string, IDialogue> = this.dialogueHelper.getDialogsForProfile(arg0?.sessionId);
            const dialog = dialogs[managerProfile._id];
            if (dialog) {
                const count: number = dialog.messages.length;
                dialog.messages = [];
                return `已清除${count}条聊天记录, 重启游戏客户端后生效`;
            } else {
                return `找不到你的聊天记录`
            }
        }
    }

    /**
     * 验证命令参数是否合法, 如果不合法
     * 返回不合法原因, 如果合法返回null
     * @param parametrics 
     * @returns 
     */
    protected verifyIParametrics(parametrics: IParametrics): string | null {
        if (!parametrics.sessionId) { return '未输入session参数' };
        const playerId = this.getPMCProfile(parametrics.sessionId);
        if (!playerId) { return '用户未注册或者session已失效' };
        if (!parametrics.managerChat) { return '实例未正确初始化: 缺少managerChat属性' };
        if (!(parametrics.paras instanceof Map)) { return '实例未正确初始化: 缺少paras属性' };
        return null;
    }

    protected getArchivesBySession(sessionId: string): { [key: string]: IRaidInfoArchive } {
        const playerId = this.getPMCProfile(sessionId);
        if (!playerId) { return {} };
        return this.raidInfoServerArchive[playerId] || {};
    }

    protected getArchiveListBySession(sessionId: string): IRaidInfoArchive[] {
        return this.sortArchiveList(Object.values(this.getArchivesBySession(sessionId) ?? {}));
    }

    protected sortArchiveList(archives: IRaidInfoArchive[]): IRaidInfoArchive[] {
        return archives.sort((a, b) => a.createTime - b.createTime);
    }

    protected getArchiveDetails(archive: IRaidInfoArchive): string {
        let msg = '';
        const serverId: string = archive.serverId;
        const playerId: string = archive.playerId;
        const playerData: IPmcData = this.profileHelper.getProfileByPmcId(playerId);
        const _timeString = DateFormatter.full(archive.createTime);
        const mapName: string = serverId.substring(0, serverId.indexOf('.')).toLowerCase();
        msg += `${_timeString} 对局ID: ${serverId} 玩家信息: ${playerData.Info.Nickname}(Level=${playerData.Info.Level}, id=${playerData._id})`;
        msg += `\n地图: ${mapNames[mapName]} 生存时间: ${timeString(archive?.results?.playTime || 0)}`;
        msg += `\n入局战备: ${~~archive.equipmentValue}rub, 安全箱物资价值: ${~~archive.securedValue}rub, 总带入价值: ${~~archive.entryValue}rub`
        msg += `\n突袭带出物品数量: ${(archive?.addition || []).length} 带出价值: ${~~(archive?.grossProfit || 0)}rub, 战损${~~(archive?.combatLosses || 0)}rub, 净利润${~~(archive.grossProfit - archive.combatLosses)}rub`;
        
        const result: string = resultNames[archive.results.result] || archive.results.result;
        
        msg += `\n对局结果: ${result} 撤离点: ${(extractionPointNames?.[mapName]?.[archive.results.exitName] ?? archive.results.exitName) ?? '未撤离'} 游戏风格: ${archive?.eftStats?.SurvivorClass || '未知'}`

        const victims: IVictim[] = archive?.eftStats?.Victims || [];
        const locals: Record<string, string> = this.databaseService.getTables().locales.global['ch'];

        if (victims.length > 0) {

            msg += `\n本局击杀:`
            for (const victim of victims) {
                msg += `\n ${victim.Time} 使用${locals[victim.Weapon] || (victim.Weapon || '未知武器')}命中${armorZone[victim.BodyPart] || victim.BodyPart}淘汰距离${~~victim.Distance}m远的${victim.Name}(等级:${victim.Level} 阵营:${victim.Side} 角色:${roldNames[victim.Role] || victim.Role})`
            }
        }

        if (archive.results.result == 'Killed') {
            const aggressor: IAggressor = archive.eftStats.Aggressor || null;
            if (aggressor) {
                msg += `\n击杀者: ${aggressor.Name}(阵营: ${aggressor.Side})使用${locals[aggressor.WeaponName] || (aggressor.WeaponName || '未知武器')}命中${armorZone[aggressor.BodyPart] || aggressor.BodyPart}淘汰了你`
            } else {
                msg += `\n击杀者数据加载失败`
            }
            
        }

        return msg;
    }

    protected checkArchive(archive: IRaidInfoArchive): string {
        let msg = '';
        const serverId: string = archive.serverId;
        const playerId: string = archive.playerId;
        msg += `serverId: ${serverId ? '存在' : '缺失'}`;
        msg += `\nplayerId: ${playerId ? '存在' : '缺失'}`;
        msg += `\nstate: ${archive.state}`;

        const itemHelper = this.itemHelper;
        const getPrice: (item: IItemArchive) => number = (item: IItemArchive) => { 
            return Math.max(0, Math.abs(item.modify) * itemHelper.getItemPrice(item.tpl)); 
        }
        // 由于压缩存档损失了部分信息, 入场战备, 安全箱价值等不会再被修正; 只修正收益和战损
        const oldGrossProfit = archive.grossProfit, oldCombatLosses = archive.combatLosses;
        let grossProfit = 0, combatLosses = 0;
        for (const item of Object.values(pickDict(archive.raidInventoryEnd, archive.addition))) {
            grossProfit += getPrice(item);
        }
        for (const item of Object.values(pickDict(archive.raidInventoryBegin, archive.remove))) {
            combatLosses += getPrice(item);
        }
        for (const item of Object.values(pickDict(archive.raidInventoryBegin, archive.used))) {
            const delta = getPrice(archive.raidInventoryEnd[item.id]) - getPrice(item);
            if (delta > 0) {
                grossProfit += delta;
            } else {
                combatLosses += Math.abs(delta);
            }
        }
        if (Math.abs(grossProfit - oldGrossProfit) > archiveCheckJudgeError ||
                Math.abs(combatLosses - oldCombatLosses) > archiveCheckJudgeError) {
            archive.grossProfit = grossProfit;
            archive.combatLosses = combatLosses;
            this.fileSystem.writeJson(path.join(__dirname, jsonRaidRecordPath), this.raidInfoServerArchive, 2);
            msg += `\n收益和战损部分: 收益(${~~oldGrossProfit}->${~~grossProfit}) 战损(${~~oldCombatLosses}->${~~combatLosses})`
        }
        else {
            msg += `\n收益和战损部分: 无明显错误`
        }
        return msg;
    }
}

class DateFormatter {
    // 完整格式：2023-10-01 14:30:25
    static full(timestamp: number): string {
        const date = new Date(timestamp);
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const time = date.toTimeString().slice(0, 8);
        
        return `${year}年${month}月${day}日 ${time}`;
    }
    
    // 简短格式：2023-10-01 14:30
    static short(timestamp: number): string {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }
    
    // 仅日期：2023-10-01
    static dateOnly(timestamp: number): string {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        return `${year}年${month}月${day}日`;
    }
    
    // 相对时间（如：刚刚、5分钟前、3小时前等）
    static relative(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;
        
        if (diff < minute) {
            return '刚刚';
        } else if (diff < hour) {
            return `${Math.floor(diff / minute)}分钟前`;
        } else if (diff < day) {
            return `${Math.floor(diff / hour)}小时前`;
        } else if (diff < 3 * day) {
            return `${Math.floor(diff / day)}天前`;
        } else {
            return this.dateOnly(timestamp);
        }
    }
}