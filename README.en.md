[![Demo: from drawing and slide frames to export and viewing in PowerPoint](docs/demo.gif)](docs/demo.mp4?raw=true)

[Download the full demo (MP4, about 1 minute)](docs/demo.mp4?raw=true)

# draw.io Slides

[日本語](README.md) | English

A local application for placing slide frames on a single draw.io canvas and exporting the selected areas to PowerPoint (`.pptx`). Keep diagrams, reusable assets, and notes together on the canvas while preparing presentation slides.

Create diagrams in a dedicated draw.io workspace, then choose between image export and a format with elements you can edit in PowerPoint. This project is an unofficial extension to draw.io.

## Features

- Add slide frames, register existing rectangles as frames, and lock frames
- Reorder slides, rename them, and choose which slides to export
- Organize slides into multiple presentation sets with 16:9 or 4:3 aspect ratios
- Save diagrams and slide settings together in a `.drawio` file
- Collapse the top toolbar and slide list

## Requirements

- Node.js 22 or later and npm
- Git and tar
- A Chromium-based browser, such as Chrome or Edge

An internet connection is required during initial setup to download dependencies and draw.io.

## Installation and startup

```sh
git clone https://github.com/lgtmmube/drawio-slides.git
cd drawio-slides
npm ci
npm run setup:editor
npm run build
npm start
```

The application opens in your browser at [http://127.0.0.1:48765/](http://127.0.0.1:48765/). `setup:editor` downloads draw.io, and `build` generates the files needed to run the application.

For subsequent launches, run `npm start` from the project directory. On Windows, you can also double-click `start-drawio-slides.cmd`. On macOS and Linux, run `./start-drawio-slides.sh`.

Keep the terminal running while using the application. To quit, save your drawing and press `Ctrl+C` in the terminal.

## Usage

The application's controls are currently in Japanese. Their labels are included below to help you find them.

1. Open a `.drawio` file or create a new drawing. A sample is available from the start screen or Help (「ヘルプ」).
2. Click Add slide (「スライドを追加」), then click the canvas to place a frame. To use an existing rectangle, select it and click Register selected frame (「選択枠を登録」).
3. Draw inside the frames. Use the list on the right to set slide titles and order, and choose which slides to include in the export.
4. Click Export to PowerPoint (「PowerPoint出力」) to preview all slides, choose an export mode, and export. Click a slide in the preview grid to enlarge it; you can also move to the previous or next slide. The export includes the presentation set selected on the current draw.io page.
5. Click Save (「保存」) to save your drawing and slide settings to a `.drawio` file.

Frames are guides that define the export area. Moving or deleting a frame does not move or delete the shapes inside it. Frame borders and titles are excluded from the export.

Use the arrows at the edges of the top bar and right-hand list to collapse or expand them. The browser remembers their visibility settings.

## Export modes

| Mode | Output | Editing in PowerPoint |
| --- | --- | --- |
| Image (「画像モード」) | Each slide contains a single image rendered by draw.io | Move or resize the whole image |
| Editable (「編集可能モード」) | Supported text, basic shapes, and arrows become separate elements; special assets are placed as images | Edit supported elements individually |

Image mode is suitable when you want to preserve the original layout and line breaks. Choose an image width of 1920 or 3840 pixels.

In editable mode, fonts, text wrapping, and styling in PowerPoint may change the appearance. Arrows can be edited individually, but they do not stay connected automatically when you move shapes. Shapes that cross a frame boundary may extend beyond the slide.

## Saving and data handling

Diagrams and slide settings are saved in a `.drawio` file that can also be opened in the standard draw.io editor. In supported browsers, saving updates the opened file; other browsers download a file instead.

The browser also saves a temporary draft while you work. This does not replace saving to a file: clearing browser data, for example, can remove the draft.

Each export generates a new PowerPoint file. Changes made in PowerPoint are not written back to the draw.io drawing.

Conversion runs in the browser. Images loaded from external URLs and web fonts require requests to their respective sources. Access restrictions at those sources may prevent export.

## Development

After installing dependencies and setting up draw.io, start the development server:

```sh
npm run dev
```

Run the tests:

```sh
npm test
node scripts/check-server.mjs
npx playwright install chromium
npm run test:browser
```

Run the additional editor conversion tests with the development server running:

```sh
node tests/editor-bridge.browser.mjs
```

For browser tests, set `CHROME_PATH` to the Chromium executable or `APP_URL` to the URL of an already running server.

## Third-party libraries

See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) for licenses and copyright notices for draw.io and other dependencies. License files for the downloaded draw.io editor are also stored in `public/editor/`.
