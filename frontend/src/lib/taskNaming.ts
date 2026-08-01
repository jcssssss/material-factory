// 任务名自动推导：去掉任务名表单项后，由资料文件夹名推导任务名。
// taskName 仍承担输出目录一级子目录名（{outputDir}/{任务名}/…）与展示/日志标识，
// 只是不再由用户手输，改为从输入自动填充，队列/历史/断点/日志全链路无需改动。

// 取路径末段（兼容 Windows 反斜杠），与项目内统一 basename 实现一致。
function pathBaseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// 由输入推导任务名：folder 模式 sourcePaths[0] 为资料文件夹路径，basename 即文件夹名。
// 空/异常路径 fallback「未命名任务」，保证不产生空任务名。
export function deriveTaskName(sourcePaths: string[]): string {
  const folder = sourcePaths[0] ?? "";
  const name = pathBaseName(folder).trim();
  return name || "未命名任务";
}

// 同名冲突去重：
//   - 重跑同一批（同 outputDir 且同输入路径）→ 允许同名覆盖旧输出；
//   - 不同输入占用同名 → 追加 -2/-3… 保证输出目录不互相覆盖。
// existing 来自队列 + 历史 + 断点的任务配置快照。
export function resolveUniqueTaskName(
  base: string,
  outputDir: string,
  inputPath: string,
  existing: { outputDir: string; taskName: string; sourcePaths: string[] }[],
): string {
  // 同一批资料重跑：允许同名（输出目录一致，覆盖旧结果，不产生冗余目录）。
  const sameInput = existing.some(
    (t) => t.outputDir === outputDir && t.sourcePaths[0] === inputPath
  );
  if (sameInput) return base;

  // 同名未被不同输入占用：直接使用。
  const nameTaken = existing.some(
    (t) => t.outputDir === outputDir && t.taskName === base
  );
  if (!nameTaken) return base;

  // 同名被其他输入占用：追加序号直至无冲突。
  let n = 2;
  while (
    existing.some(
      (t) => t.outputDir === outputDir && t.taskName === `${base}-${n}`
    )
  ) {
    n += 1;
  }
  return `${base}-${n}`;
}
