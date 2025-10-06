#!/usr/bin/env node

/**
 * 构建脚本
 *
 * 该脚本可自动执行服务器端 SPT mod 项目的构建过程，便于创建可分发的
 * 模块包。它将执行以下一系列操作：
 * 加载 .buildignore 文件，该文件用于列出在构建过程中应忽略的文件。
 * 加载 package.json，获取项目详细信息，以便为 MOD 包创建一个描述性名称。
 * 创建分发目录和临时工作目录。
 * 在遵守 .buildignore 规则的前提下，将文件复制到临时目录。
 * 创建项目文件的压缩包。
 * 将 zip 文件移动到分发目录的根目录。
 * 清理临时目录。
 *
 * 该脚本通常可根据每个项目的需要进行定制。例如，可以更新脚本
 * 执行其他操作，例如将 mod 包移动到特定位置或上传到服务器。
 * 本脚本旨在为开发者提供一个起点，以便在此基础上继续开发。
 *
 * 使用方法：
 * 使用 npm：`npm run build` 运行此脚本
 * 使用 `npm run buildinfo` 获取详细日志。
 *
 * 注意
 * - 确保在运行脚本之前安装了所有必要的 Node.js 模块： npm install
 * - 脚本从 `package.json` 和 `.buildignore` 文件读取配置；确保它们设置正确。
 *
 * @author Refringe
 * @version v1.0.0
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import ignore from "ignore";
import archiver from "archiver";
import winston from "winston";

// 获取命令行参数，以确定是否使用详细日志记录。
const args = process.argv.slice(2);
const verbose = args.includes("--verbose") || args.includes("-v");

// 配置 Winston 记录仪以使用颜色。
const logColors = {
    error: "red",
    warn: "yellow",
    info: "grey",
    success: "green",
};
winston.addColors(logColors);

// 创建一个日志记录器实例来记录构建进度。配置日志记录器级别，以便根据冗长程度标志设置不同级别的日志记录
// 并将控制台传输设置为记录相应级别的信息。
const logger = winston.createLogger({
    levels: {
        error: 0,
        warn: 1,
        success: 2,
        info: 3,
    },
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(info => {
            return `${info.level}: ${info.message}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            level: verbose ? "info" : "success",
        }),
    ],
});

/**
 * 主函数负责协调创建可发布 mod 包的构建过程。它利用一系列
 * 辅助函数来执行各种任务，如加载配置文件、设置目录、根据`.buildignore`规则复制文件
 * 根据".buildignore "规则复制文件，以及创建项目文件的 ZIP 压缩包。
 *
 * 利用 Winston 日志记录器提供进程不同阶段的构建状态信息。
 *
 * @returns {void}
 */
async function main() {
    // 获取正在执行脚本的当前目录
    const currentDir = getCurrentDirectory();

    // 在此范围内定义是因为我们需要在 finally 代码块中使用它。
    let projectDir;

    try {
        // 加载 .buildignore 文件，为构建过程设置忽略处理程序。
        const buildIgnorePatterns = await loadBuildIgnoreFile(currentDir);

        // 加载 package.json 文件，获取项目详细信息。
        const packageJson = await loadPackageJson(currentDir);

        // Create a descriptive name for the mod package.
        const projectName = createProjectName(packageJson);
        logger.log("success", `项目名称已创建：${projectName}`);

        // Remove the old distribution directory and create a fresh one.
        const distDir = await removeOldDistDirectory(currentDir);
        logger.log("info", "分发目录清理完成");

        // Create a temporary working directory to perform the build operations.
        projectDir = await createTemporaryDirectoryWithProjectName(projectName);
        logger.log("success", "临时工作目录创建成功");
        logger.log("info", projectDir);

        // Copy files to the temporary directory while respecting the .buildignore rules.
        logger.log("info", "开始使用 .buildignore 文件进行复制操作...");
        await copyFiles(currentDir, projectDir, buildIgnorePatterns);
        logger.log("success", "文件已成功复制到临时目录");

        // Create a zip archive of the project files.
        logger.log("info", "开始文件夹压缩...");
        const zipFilePath = path.join(path.dirname(projectDir), `${projectName}.zip`);
        await createZipFile(projectDir, zipFilePath, "user/mods/" + projectName);
        logger.log("success", "归档文件创建成功");
        logger.log("info", zipFilePath);

        // Move the zip file inside of the project directory, within the temporary working directory.
        const zipFileInProjectDir = path.join(projectDir, `${projectName}.zip`);
        await fs.move(zipFilePath, zipFileInProjectDir);
        logger.log("success", "归档文件移动成功");
        logger.log("info", zipFileInProjectDir);

        // Move the temporary directory into the distribution directory.
        await fs.move(projectDir, distDir);
        logger.log("success", "临时目录已成功移动到项目分发目录");

        // Log the success message. Write out the path to the mod package.
        logger.log("success", "------------------------------------");
        logger.log("success", "构建脚本执行成功！");
        logger.log("success", "您的模组包已创建在 'dist' 目录中：");
        logger.log("success", `/${path.relative(process.cwd(), path.join(distDir, `${projectName}.zip`))}`);
        logger.log("success", "------------------------------------");
        if (!verbose) {
            logger.log("success", "查看详细构建日志，请使用 `npm run buildinfo`");
            logger.log("success", "------------------------------------");
        }
    } catch (err) {
        // If any of the file operations fail, log the error.
        logger.log("error", "发生错误: " + err);
    } finally {
        // Clean up the temporary directory, even if the build fails.
        if (projectDir) {
            try {
                await fs.promises.rm(projectDir, { force: true, recursive: true });
                logger.log("info", "已清理临时目录");
            } catch (err) {
                logger.log("error", "清理临时目录失败: " + err);
            }
        }
    }
}


/**
 * 获取脚本正在执行的当前工作目录。该目录在整个构建过程中作为各种文件操作的参考点，
 * 确保无论从何处调用脚本，路径都能正确解析。
 *
 * @returns {string} 当前工作目录的绝对路径。
 */
function getCurrentDirectory() {
    return path.dirname(fileURLToPath(import.meta.url));
}


/**
 * 加载 `.buildignore` 文件并使用 `ignore` 模块设置忽略处理器。`.buildignore` 文件包含
 * 构建过程中应忽略的文件和目录模式列表。此方法创建的忽略处理器用于在将文件和目录
 * 复制到临时目录时进行过滤，确保最终模组包中仅包含必要的文件。
 *
 * @param {string} currentDirectory - 当前工作目录的绝对路径。
 * @returns {Promise<ignore>} 解析为忽略处理器的 Promise。
 */
async function loadBuildIgnoreFile(currentDir) {
    const buildIgnorePath = path.join(currentDir, ".buildignore");

    try {
        // Attempt to read the contents of the .buildignore file asynchronously.
        const fileContent = await fs.promises.readFile(buildIgnorePath, "utf-8");

        // Return a new ignore instance and add the rules from the .buildignore file (split by newlines).
        return ignore().add(fileContent.split("\n"));
    } catch (err) {
        logger.log("warn", "读取 .buildignore 文件失败。不会忽略任何文件或目录。");

        // Return an empty ignore instance, ensuring the build process can continue.
        return ignore();
    }
}

/**
 * 加载 `package.json` 文件并将其内容作为 JSON 对象返回。`package.json` 文件包含重要的
 * 项目详细信息，例如名称和版本，这些信息将在构建过程的后续阶段用于为模组包创建描述性名称。
 * 该方法从当前工作目录读取文件，确保其准确反映项目的当前状态。
 *
 * @param {string} currentDirectory - 当前工作目录的绝对路径。
 * @returns {Promise<Object>} 解析为包含 `package.json` 内容的 JSON 对象的 Promise。
 */
async function loadPackageJson(currentDir) {
    const packageJsonPath = path.join(currentDir, "package.json");

    // Read the contents of the package.json file asynchronously as a UTF-8 string.
    const packageJsonContent = await fs.promises.readFile(packageJsonPath, "utf-8");

    return JSON.parse(packageJsonContent);
}

/**
 * 使用 `package.json` 文件中的详细信息构建模组包的描述性名称。该名称通过拼接项目名称、
 * 版本号和时间戳来创建，为每次构建生成唯一且具有描述性的文件名。此名称用作临时工作目录
 * 和最终 ZIP 归档文件的基础名称，有助于轻松识别不同版本的模组包。
 *
 * @param {Object} packageJson - 包含 `package.json` 文件内容的 JSON 对象。
 * @returns {string} 表示构建的项目名称的字符串。
 */
function createProjectName(packageJson) {
    // Remove any non-alphanumeric characters from the author and name.
    const author = packageJson.author.replace(/\W/g, "");
    // const name = packageJson.name.replace(/\W/g, "");
    // 保留中文, [, ], 英文, 下划线
    const name = packageJson.name.replace(/[^a-zA-Z0-9_[\]\u4e00-\u9fa5]/g, "_");
    

    // Ensure the name is lowercase, as per the package.json specification.
    return `${author}-${name}`.toLowerCase();
}


/**
 * 定义最终模组包存储的分发目录位置，并删除任何现有的分发目录以确保构建过程从零开始。
 *
 * @param {string} currentDirectory - 当前工作目录的绝对路径。
 * @returns {Promise<string>} 解析为分发目录绝对路径的 Promise。
 */
async function removeOldDistDirectory(projectDir) {
    const distPath = path.join(projectDir, "dist");
    await fs.remove(distPath);
    return distPath;
}

/**
 * 使用项目名称创建临时工作目录。该目录作为暂存区，在项目文件被归档到最终模组包之前在此处收集。
 * 该方法通过将项目名称附加到基础临时目录路径来构建唯一的目录路径，确保每次构建都有自己独立的
 * 工作空间。这种方法有助于实现干净有序的构建过程，避免与其他构建发生潜在冲突。
 *
 * @param {string} currentDirectory - 当前工作目录的绝对路径。
 * @param {string} projectName - 构建的项目名称，用于为临时目录创建唯一路径。
 * @returns {Promise<string>} 解析为新创建的临时目录绝对路径的 Promise。
 */
async function createTemporaryDirectoryWithProjectName(projectName) {
    // Create a new directory in the system's temporary folder to hold the project files.
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "spt-mod-build-"));

    // Create a subdirectory within the temporary directory using the project name for this specific build.
    const projectDir = path.join(tempDir, projectName);
    await fs.ensureDir(projectDir);

    return projectDir;
}

/**
 * 将项目文件复制到临时目录，同时遵循 `.buildignore` 文件中定义的规则。
 * 该方法是递归的，遍历源目录中的所有文件和目录，并使用忽略处理器过滤掉与
 * `.buildignore` 文件中定义的模式匹配的文件和目录。这确保最终模组包中仅包含
 * 必要的文件，遵循开发者在 `.buildignore` 文件中定义的规范。
 *
 * 复制操作被延迟并并行执行，以提高效率并减少构建时间。这是通过创建复制 Promise 数组
 * 并在函数末尾统一等待它们来实现的。
 *
 * @param {string} sourceDirectory - 当前工作目录的绝对路径。
 * @param {string} destinationDirectory - 文件将被复制到的临时目录的绝对路径。
 * @param {Ignore} ignoreHandler - 从 `.buildignore` 文件创建的忽略处理器。
 * @returns {Promise<void>} 当所有复制操作成功完成时解析的 Promise。
 */
async function copyFiles(srcDir, destDir, ignoreHandler) {
    try {
        // Read the contents of the source directory to get a list of entries (files and directories).
        const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

        // Initialize an array to hold the promises returned by recursive calls to copyFiles and copyFile operations.
        const copyOperations = [];

        for (const entry of entries) {
            // Define the source and destination paths for each entry.
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);

            // Get the relative path of the source file to check against the ignore handler.
            const relativePath = path.relative(process.cwd(), srcPath);

            // If the ignore handler dictates that this file should be ignored, skip to the next iteration.
            if (ignoreHandler.ignores(relativePath)) {
                logger.log("info", `已忽视: /${path.relative(process.cwd(), srcPath)}`);
                continue;
            }

            if (entry.isDirectory()) {
                // If the entry is a directory, create the corresponding temporary directory and make a recursive call
                // to copyFiles to handle copying the contents of the directory.
                await fs.ensureDir(destPath);
                copyOperations.push(copyFiles(srcPath, destPath, ignoreHandler));
            } else {
                // If the entry is a file, add a copyFile operation to the copyOperations array and log the event when
                // the operation is successful.
                copyOperations.push(
                    fs.copy(srcPath, destPath).then(() => {
                        logger.log("info", `已复制: /${path.relative(process.cwd(), srcPath)}`);
                    })
                );
            }
        }

        // Await all copy operations to ensure all files and directories are copied before exiting the function.
        await Promise.all(copyOperations);
    } catch (err) {
        // Log an error message if any error occurs during the copy process.
        logger.log("error", "复制文件过程中发生错误: " + err);
    }
}

/**
 * 创建位于临时目录中的项目文件的 ZIP 归档。该方法使用 `archiver` 模块创建 ZIP 文件，
 * 其中包含构建过程中已复制到临时目录的所有文件。ZIP 文件使用项目名称命名，
 * 有助于轻松识别归档内容。
 *
 * @param {string} directoryPath - 包含项目文件的临时目录的绝对路径。
 * @param {string} projectName - 构建的项目名称，用于命名 ZIP 文件。
 * @returns {Promise<string>} 解析为创建的 ZIP 文件绝对路径的 Promise。
 */
async function createZipFile(directoryToZip, zipFilePath, containerDirName) {
    return new Promise((resolve, reject) => {
        // Create a write stream to the specified ZIP file path.
        const output = fs.createWriteStream(zipFilePath);

        // Create a new archiver instance with ZIP format and maximum compression level.
        const archive = archiver("zip", {
            zlib: { level: 9 },
        });

        // Set up an event listener for the 'close' event to resolve the promise when the archiver has finalized.
        output.on("close", function () {
            logger.log("info", "存档程序已完成。输出和文件描述符已关闭。");
            resolve();
        });

        // Set up an event listener for the 'warning' event to handle warnings appropriately, logging them or rejecting
        // the promise based on the error code.
        archive.on("warning", function (err) {
            if (err.code === "ENOENT") {
                logger.log("warn", `存档程序发出警告： ${err.code} - ${err.message}`);
            } else {
                reject(err);
            }
        });

        // Set up an event listener for the 'error' event to reject the promise if any error occurs during archiving.
        archive.on("error", function (err) {
            reject(err);
        });

        // Pipe archive data to the file.
        archive.pipe(output);

        // Add the directory to the archive, under the provided directory name.
        archive.directory(directoryToZip, containerDirName);

        // Finalize the archive, indicating that no more files will be added and triggering the 'close' event once all
        // data has been written.
        archive.finalize();
    });
}

// Engage!
main();
