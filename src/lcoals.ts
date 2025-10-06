// 地图名称本地化
export const mapNames: Record<string, string> = {
    "factory4_day": "工厂(白天)",
    "factory4_night": "工厂(夜晚)",
    "bigmap": "海关",
    "woods": "森林",
    "shoreline": "海岸线",
    "interchange": "立交桥",
    "rezervbase": "储备站",
    "laboratory": "实验室",
    "lighthouse": "灯塔",
    "tarkovstreets": "街区",
    "sandbox": "中心区",
};

// 结果的本地化字符串
export const resultNames: Record<string, string> = {
    "Survived": "幸存",
    "Killed": "行动中阵亡",
    "Left": "离开行动",
    "MissingInAction": "行动中失踪",
    "Runner": "匆匆逃离",
}

// 撤离点的本地化字符串
export const extractionPointNames: Record<string, Record<string, string>> = {
    "factory4_day": {
        "Gate 0": "0号门",
        "Gate 2": "2号门",
        "Gate 3": "3号门",
        "Gate To Factory": "通往工厂的大门",
        "Gate m": "医疗帐篷大门",
        "Gate_o": "庭院大门",
    },
    "sandbox": {
        "Sandbox_VExit": "警方封锁线（载具撤离点）",
        "Unity_free_exit": "Emercom检查点",
    },
    "laboratory": {
        "lab_Elevator_Cargo": "货运电梯",
        "lab_Elevator_Main": "主电梯",
        "lab_Elevator_med": "医疗区电梯",
        "lab_Hangar_Gate": "机库大门",
        "lab_Parking_Gate": "停车场大门",
        "lab_Under_Storage_Collector": "污水管道",
        "lab_Vent": "通风管道",
    }
}

// 命中区域的本地化
export const armorZone: Record<string, string> = {
    /// QuestCondition/Elimination/Kill/BodyPart/
    "Chest": "胸腔",
    "Head": "头部",
    "LeftArm": "左臂",
    "LeftLeg": "左腿",
    "RightArm": "右臂",
    "RightLeg": "右腿",
    // "Stomach": "胃部",
    /// Collider Type 
    "Back": "胸部, 背部",
    "BackHead": "头部, 脖颈",
    "Ears": "头部, 耳部",
    "Eyes": "头部, 眼部",
    "Groin": "胃部, 股沟",
    "HeadCommon": "头部, 脸部",
    "Jaw": "头部, 下颚",
    "LeftCalf": "左腿, 小腿",
    "LeftForearm": "左臂, 前臂",
    "LeftSide": "左下身",
    "LeftSideChestDown": "胃部, 左侧",
    "LeftSideChestUp": "胸部, 左腋下",
    "LeftThigh": "左腿, 大腿",
    "LeftUpperArm": "左臂, 手臂",
    "LowerBack": "胃部, 下背部",
    "NeckBack": "胸部, 脖子",
    "NeckFront": "胸部, 喉部",
    "ParietalHead": "头部, 头顶",
    "Pelvis": "胃部, 股沟",
    "PelvisBack": "胃部, 臀部",
    "Ribcage": "胸腔",
    "RibcageLow": "胃部",
    "RibcageUp": "胸部",
    "RightCalf": "右腿, 小腿",
    "RightForearm": "右臂, 前臂",
    "RightSide": "右下身",
    "RightSideChestDown": "胃部, 右侧",
    "RightSideChestUp": "胸部, 右腋下",
    "RightThigh": "右腿, 大腿",
    "RightUpperArm": "右臂, 手臂",
    "SpineDown": "胃部, 下背部",
    "SpineTop": "胸腔, 上背部",
    "Stomach": "胃部",
}


// Scav角色本地化
export const roldNames: Record<string, string> = {
    "ArenaFighterEvent": "寻血猎犬",
    "Boss": "Boss",
    "ExUsec": "游荡者",
    "Follower": "保镖",
    "Marksman": "狙击手",
    "PmcBot": "掠夺者",
    "Sectant": "???",
    "infectedAssault": "感染者",
    "infectedCivil": "感染者",
    "infectedLaborant": "感染者",
    "infectedPmc": "感染者",
    "infectedTagilla": "感染者",
    // 更本地化一点
    "pmcBot": "人机",
    "pmcBEAR": "BearPMC",
    "pmcUSER": "UserPMC"
}

// 幸存者风格
export const survivorClassNames: Record<string, string> = {
    "Marauder": "掠夺者"
}