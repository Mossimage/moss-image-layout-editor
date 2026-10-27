# moss-image-layout-editor

[English](README.md) · **[在线使用](https://moss-image-community.github.io/moss-image-layout-editor/?lang=zh)**

社区项目，与 OpenMOSS 官方无关。

给 [MOSS-Image](https://github.com/OpenMOSS/MOSS-Image) 布局草稿用的可视化编辑器。在画布上安排文字、物体和角色，再复制一份与官方 `compile_prompt.py` 同样方式编译出来的提示词。

这是一个静态网站。它不调用生成接口，也没有后端或统计服务。

界面有英文和简体中文。顶栏可以在 EN 和 中文 之间切换。链接带 `?lang=en` 或 `?lang=zh` 时使用对应语言；否则先用上次保存的选择，再看浏览器语言。示例里的描述保持草稿原文。编译后的提示词和导出的 JSON 不会被翻译。

## 截图

![布局编辑器打开一份海报草稿，画布上有方框，旁边是编译后的提示词](docs/editor.png)

## 和官方编译器的关系

MOSS-Image 的布局提示词使用紧凑 JSON（`bbox_coord_space` 为 `abs_centralized`，`bbox_format` 为 `yxyx`）。官方的 prompt-enhancer skill 另存一份可编辑草稿：以左上角为原点的 `xyxy` 像素框，外加 `width` 和 `height`，再用下面的脚本编译：

[`skills/moss-image-prompt-enhancer/scripts/compile_prompt.py`](https://github.com/OpenMOSS/MOSS-Image/blob/a211e398a33cbf4dd7a1cc52aba0dfdbac3b0281/skills/moss-image-prompt-enhancer/scripts/compile_prompt.py)

`src/compile/compilePrompt.ts` 是该脚本的 TypeScript 移植。它检查同样的字段，并按同样的方式转换方框：每条边先按 binary64 的精确值四舍五入到 9 位小数（一半向偶数），上边和左边取 floor，下边和右边取 ceil，再减去画布一半的整数除法。编译结果是一行 JSON，不含宽高。出图时请另外使用这两个尺寸。

`tests/compilePrompt.test.ts` 移植自 [`test_compile_prompt.py`](https://github.com/OpenMOSS/MOSS-Image/blob/a211e398a33cbf4dd7a1cc52aba0dfdbac3b0281/skills/moss-image-prompt-enhancer/scripts/test_compile_prompt.py)。

对照 [OpenMOSS/MOSS-Image](https://github.com/OpenMOSS/MOSS-Image) 提交 [`a211e398a33cbf4dd7a1cc52aba0dfdbac3b0281`](https://github.com/OpenMOSS/MOSS-Image/commit/a211e398a33cbf4dd7a1cc52aba0dfdbac3b0281) 核对过。在那棵树里，`compile_prompt.py` 的 blob 是 `ff7aaa85fa1b0ae4e97bb1ca5b698093dfdd5aee`，`test_compile_prompt.py` 的 blob 是 `fcf410b68c5faa1f4a2b6c4691656fc8a45b6203`，两者自 [`20f5592077916ec8d439bed7b34d18e45c20d657`](https://github.com/OpenMOSS/MOSS-Image/commit/20f5592077916ec8d439bed7b34d18e45c20d657) 起没有改过。

草稿格式见该 skill 的 [layout reference](https://github.com/OpenMOSS/MOSS-Image/blob/a211e398a33cbf4dd7a1cc52aba0dfdbac3b0281/skills/moss-image-prompt-enhancer/references/layout.md)：

- 方框是 `[x_min, y_min, x_max, y_max]`，像素，原点在左上角。
- `width` 和 `height` 是 16 的正整数倍。
- `bbox_coord_space` 为 `abs`，`bbox_format` 为 `xyxy`。
- 每个元素有 `label`（`text`、`object` 或 `character`）和 `caption`。
- 文字元素包含字面量 `text`。字符串里的换行就是要绘制的换行。
- `summary` 包含 `caption`，需要时还可以有 `meta`、`canvas`（`single`、`multi_panel` 或 `collage`）和 `palette`。

改画布尺寸时，方框留在原处。导出的就是这份草稿。侧栏显示编译结果。编辑器把单边限制在 4096 像素以内；编译器本身没有这个限制。只有在把画布改成参考图尺寸并选择 Scale boxes 时，方框才会按比例缩放。

## 示例

应用里有四份为这个编辑器写的草稿：海报、菜单、漫画页和书籍封面。它们是官方草稿格式的布局 JSON，用来当作构图起点。它们不是模型出图样例。里面都不含参考图。

## 参考图

用 Reference 按钮载入本地图片，或把文件拖到画布上，作为方框下面的一层。图片以 object URL 留在浏览器里。它不会被上传，编辑器也不会调用生成接口。

显示、隐藏和不透明度只影响这一层。移除会丢掉它。Use image size 把画布设成图片的像素尺寸，长边最多 4096。如果已经有方框，会先确认是保持原位置，还是按新画布等比例缩放。否则图片按比例放进当前画布。

参考图不会写入导出的草稿，也不会进入编译结果，所以提示词与官方编译器的输出一致。

一种用法是：把你用 MOSS-Image 生成的图叠在下面，对照它调整方框和文字，再导出一份新草稿重新生成。

## 运行、测试、构建

需要 Node.js 22 或更新版本。

```bash
npm install
npm run dev          # http://localhost:5173
npm test
npm run build        # static site in dist/
npm run preview
```

也可以像官方脚本那样在命令行编译一份草稿：

```bash
npx tsx src/cli.ts draft.json --output prompt.txt
```

`npm test` 会跑移植过来的编译器用例，并检查内置草稿能够编译。

## 静态托管

`npm run build` 把站点写到 `dist/`，资源使用相对地址，因此这个目录可以直接作为 GitHub 项目站点，或作为一组静态文件。推送到 `main` 时，[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 会把 `dist/` 部署到 GitHub Pages。请在仓库设置里把 Pages 的来源选为 GitHub Actions。

同一个 `dist/` 以后也可以发布成 Hugging Face 的静态 Space（Space README 里写 `sdk: static`）。不需要 Python 服务。

## 许可证

Apache-2.0。见 [LICENSE](LICENSE)。

编译器移植自 Apache-2.0 的 MOSS-Image prompt enhancer 脚本。

Used in production at [MOSS-Image AI](https://mossimages.com).
