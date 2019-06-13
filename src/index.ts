/* eslint-disable newline-per-chained-call */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable no-use-before-define */
// import { Faust } from "faust2webaudio";
// TODO
// webworkerify
// bargraph in scopes
// touch
// plot scope
// init params with getNode
// horizontal scroll
// File name strip and trim

import * as monaco from "monaco-editor"; // eslint-disable-line import/no-unresolved
import webmidi, { Input, WebMidiEventConnected, WebMidiEventDisconnected } from "webmidi";
import * as QRCode from "qrcode";
import * as WaveSurfer from "wavesurfer.js";
import { FaustScriptProcessorNode, FaustAudioWorkletNode, Faust } from "faust2webaudio";
import { Key2Midi } from "./Key2Midi";
import { Scope } from "./Scope";
import * as faustlang from "./monaco-faust";
import "bootstrap/js/dist/dropdown";
import "bootstrap/js/dist/tab";
import "bootstrap/js/dist/tooltip";
import "bootstrap/js/dist/modal";
import "@fortawesome/fontawesome-free/css/all.css";
import "bootstrap/scss/bootstrap.scss";
import "./index.scss";
import { StaticScope } from "./StaticScope";
import { Analyser } from "./Analyser";

declare global {
    interface Window {
        AudioContext: typeof AudioContext;
        webkitAudioContext: typeof AudioContext;
        AudioWorklet?: typeof AudioWorklet; // eslint-disable-line no-undef
        faustEnv: FaustEditorEnv;
    }
    interface HTMLMediaElement extends HTMLElement {
        setSinkId?(sinkId: string): Promise<undefined>;
        src: string;
    }
}
type FaustEditorEnv = {
    audioEnv: FaustEditorAudioEnv;
    midiEnv: FaustEditorMIDIEnv;
    uiEnv: FaustEditorUIEnv;
    compileOptions: FaustEditorCompileOptions;
    editor: monaco.editor.IStandaloneCodeEditor;
    jQuery: JQueryStatic;
    faust: Faust;
};
type FaustEditorAudioEnv = {
    audioCtx?: AudioContext;
    splitterInput?: ChannelSplitterNode;
    analyserInput?: AnalyserNode;
    splitterOutput?: ChannelSplitterNode;
    analyserOutput?: AnalyserNode;
    inputs?: { [deviceId: string]: MediaStreamAudioSourceNode | MediaElementAudioSourceNode };
    currentInput?: string;
    destination?: MediaStreamAudioDestinationNode | AudioDestinationNode;
    dsp?: FaustScriptProcessorNode | FaustAudioWorkletNode;
    dspConnectedToOutput: boolean;
    dspConnectedToInput: boolean;
    inputEnabled: boolean;
    outputEnabled: boolean;
};
type FaustEditorMIDIEnv = {
    input: Input;
};
type FaustEditorUIEnv = {
    analysersInited: boolean;
    inputScope: Scope;
    outputScope: Scope;
    plotScope: StaticScope;
    uiPopup?: Window;
    analyser: Analyser;
};
type FaustEditorCompileOptions = {
    name: string;
    useWorklet: boolean;
    bufferSize: 128 | 256 | 512 | 1024 | 2048 | 4096;
    saveCode: boolean;
    saveParams: boolean;
    saveDsp: boolean;
    realtimeCompile: boolean;
    popup: boolean;
    voices: number;
    plotMode: "offline" | "continuous" | "onevent" | "manual";
    plot: number;
    plotSR: number;
    plotFFT: 256 | 1024 | 4096;
    drawSpectrogram: boolean;
    args: { [key: string]: any };
};
type FaustExportTargets = { [platform: string]: string[] };

const supportAudioWorklet = !!window.AudioWorklet;
let supportMediaStreamDestination = !!(window.AudioContext || window.webkitAudioContext).prototype.createMediaStreamDestination && !!HTMLAudioElement.prototype.setSinkId;

$(async () => {
    /**
     * Async Load Faust Core
     * Use import() for webpack code splitting, needs babel-dynamic-import
     */
    const { Faust } = await import("faust2webaudio");
    const faust = new Faust({ wasmLocation: "./libfaust-wasm.wasm", dataLocation: "./libfaust-wasm.data" });
    await faust.ready;
    /**
     * To save dsp table to localStorage
     */
    const saveEditorDspTable = () => {
        localStorage.setItem("faust_editor_dsp_table", faust.stringifyDspTable());
    };
    /**
     * To load dsp table from localStorage
     */
    const loadEditorDspTable = () => {
        const str = localStorage.getItem("faust_editor_dsp_table");
        if (str) faust.parseDspTable(str);
    };
    /**
     * To save editor params to localStorage
     */
    const saveEditorParams = () => {
        const str = JSON.stringify(compileOptions);
        localStorage.setItem("faust_editor_params", str);
    };
    /**
     * To load editor params from localStorage
     *
     * @returns {(FaustEditorCompileOptions | {})}
     */
    const loadEditorParams = (): FaustEditorCompileOptions | {} => {
        const str = localStorage.getItem("faust_editor_params");
        if (!str) return {};
        try {
            return JSON.parse(localStorage.getItem("faust_editor_params")) as FaustEditorCompileOptions;
        } catch (e) {
            return {};
        }
    };
    /**
     * To show Error at bottom of center
     *
     * @param {string} str
     */
    const showError = (str: string) => {
        $(".alert-faust-code>span").text(str);
        $("#alert-faust-code").css("visibility", "visible");
    };
    /**
     * Async Load Monaco Editor Core
     * Use import() for webpack code splitting, needs babel-dynamic-import
     */
    const editor = await initEditor();
    editor.layout(); // Each time force editor to fill div
    // Editor and Diagram
    let editorDecoration: string[] = []; // lines with error
    /**
     * Generate diagram only
     *
     * @param {string} code
     * @returns {{ success: boolean; error?: Error }}
     */
    const getDiagram = (code: string): { success: boolean; error?: Error } => {
        let strSvg: string; // Diagram SVG as string
        editorDecoration = editor.deltaDecorations(editorDecoration, []);
        try {
            strSvg = faust.getDiagram(code, ["-I", compileOptions.args["-I"]]);
        } catch (e) {
            /**
             * Parse Faust-generated error message to locate the lines with error
             */
            const matchLine = e.toString().match(/FaustDSP : (\d+)/);
            if (matchLine) {
                const line = matchLine[1];
                editorDecoration = editor.deltaDecorations(editorDecoration, [{
                    range: new monaco.Range(line, 1, line, 1),
                    options: { isWholeLine: true, linesDecorationsClassName: "monaco-decoration-error" }
                }]);
            }
            showError(e);
            return { error: e, success: false };
        }
        // const $svg = $("#diagram-svg>svg");
        // const curWidth = $svg.length ? $svg.width() : "100%"; // preserve current zoom
        const svg = $<SVGSVGElement>(strSvg).filter("svg")[0];
        const width = Math.min($("#diagram").width(), $("#diagram").height() / svg.height.baseVal.value * svg.width.baseVal.value);
        $("#diagram-svg").empty().append(svg).children("svg").width(width); // replace svg;
        $("#diagram-default").hide(); // hide "No Diagram" info
        $("#alert-faust-code").css("visibility", "hidden"); // Supress error shown
        $("#diagram-svg").show(); // Show diagram div (if first time after opening page)
        return { success: true };
    };
    /**
     * Generate both diagram and dsp
     *
     * @param {string} code
     * @returns {{ success: boolean; error?: Error }}
     */
    const runDsp = async (code: string): Promise<{ success: boolean; error?: Error }> => {
        const audioCtx = audioEnv.audioCtx;
        const input = audioEnv.inputs[audioEnv.currentInput];
        let splitter = audioEnv.splitterOutput;
        const analyser = audioEnv.analyserOutput;
        if (!audioCtx) { // If audioCtx not init yet
            await initAudioCtx(audioEnv);
            initAnalysersUI(uiEnv, audioEnv);
        }
        const { useWorklet, bufferSize, voices, args } = compileOptions;
        let node: FaustScriptProcessorNode | FaustAudioWorkletNode;
        try {
            // const getDiagramResult = getDiagram(code);
            // if (!getDiagramResult.success) throw getDiagramResult.error;
            node = await faust.getNode(code, { audioCtx, useWorklet, bufferSize, voices, args, plotHandler: uiEnv.analyser.plotHandler });
            if (!node) throw new Error("Unknown Error in WebAudio Node.");
        } catch (e) { /*
            const uiWindow = ($("#iframe-faust-ui")[0] as HTMLIFrameElement).contentWindow;
            uiWindow.postMessage(JSON.stringify({ type: "clear" }), "*");
            $("#faust-ui-default").show();
            $("#iframe-faust-ui").css("visibility", "hidden");
            $("#output-analyser-ui").hide();
            refreshDspUI(); */
            showError(e);
            return { success: false, error: e };
        }
        /**
         * Push get diagram to end of scheduler
         * generate diagram only when the tab is active
         */
        if ($("#tab-diagram").hasClass("active")) setTimeout(getDiagram, 0, code);
        $("#tab-diagram").off("show.bs.tab").one("show.bs.tab", () => getDiagram(code));
        if (audioEnv.dsp) { // Disconnect current
            const dsp = audioEnv.dsp;
            if (audioEnv.dspConnectedToInput) {
                input.disconnect(dsp);
                audioEnv.dspConnectedToInput = false;
            }
            dsp.disconnect();
            audioEnv.dspConnectedToOutput = false;
            delete audioEnv.dsp;
        }
        /**
         * Update the dsp with saved params
         */
        let dspParams: { [path: string]: number } = {};
        if (compileOptions.saveParams) {
            const strDspParams = localStorage.getItem("faust_editor_dsp_params");
            if (strDspParams) {
                dspParams = JSON.parse(strDspParams);
                for (const path in dspParams) {
                    if (node.getParams().indexOf(path) !== -1) {
                        node.setParamValue(path, dspParams[path]);
                    }
                }
            }
        }
        audioEnv.audioCtx.resume().then(() => { // Resume audioContext for firefox
            /**
             * Connect the dsp to graph (use a new splitter)
             */
            audioEnv.dsp = node;
            const channelsCount = node.getNumOutputs();
            if (!splitter || splitter.numberOfOutputs !== channelsCount) {
                if (splitter) splitter.disconnect(analyser);
                splitter = audioCtx.createChannelSplitter(channelsCount);
                delete audioEnv.splitterOutput;
                audioEnv.splitterOutput = splitter;
                uiEnv.outputScope.splitter = splitter;
                uiEnv.outputScope.channels = channelsCount;
                uiEnv.outputScope.channel = Math.min(uiEnv.outputScope.channel, channelsCount - 1);
                splitter.connect(analyser, uiEnv.outputScope.channel);
            }
            if (audioEnv.inputEnabled && node.getNumInputs()) {
                audioEnv.inputs[audioEnv.currentInput].connect(node);
                audioEnv.dspConnectedToInput = true;
            }
            node.connect(splitter);
            if (audioEnv.outputEnabled) {
                node.connect(audioEnv.destination);
                audioEnv.dspConnectedToOutput = true;
            }
        });
        /**
         * Bind dsp params to ui interface
         * as UI is in an iframe and a popup window,
         * send a message with params into the window
         * bind events on param change
         */
        const bindUI = () => {
            const callback = () => {
                const msg = { type: "ui", json: node.getJSON() };
                /**
                 * Post param list json
                 */
                uiWindow.postMessage(msg, "*");
                if (uiEnv.uiPopup) uiEnv.uiPopup.postMessage(msg, "*");
                /**
                 * set handler for param changed of dsp
                 * send current value to window
                 */
                node.setOutputParamHandler((path: string, value: number) => {
                    const msg = { path, value, type: "param" };
                    uiWindow.postMessage(msg, "*");
                    if (uiEnv.uiPopup) uiEnv.uiPopup.postMessage(msg, "*");
                });
                /**
                 * Post current param values
                 */
                if (compileOptions.saveParams) {
                    const params = node.getParams();
                    for (const path in dspParams) {
                        if (params.indexOf(path) !== -1) {
                            const msg = { path, value: dspParams[path], type: "param" };
                            uiWindow.postMessage(msg, "*");
                            if (uiEnv.uiPopup) uiEnv.uiPopup.postMessage(msg, "*");
                        }
                    }
                }
            };
            /**
             * if window is opened, bind directly, else bind when window is loaded.
             */
            const uiWindow = ($("#iframe-faust-ui")[0] as HTMLIFrameElement).contentWindow;
            if (!compileOptions.popup || (uiEnv.uiPopup && !uiEnv.uiPopup.closed)) callback();
            else {
                uiEnv.uiPopup = window.open("faust_ui.html", "Faust DSP", "directories=no,titlebar=no,toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=800,height=600");
                uiEnv.uiPopup.onload = callback;
            }
        };
        bindUI();
        $("#alert-faust-code").css("visibility", "hidden"); // Supress error alert
        $("#faust-ui-default").hide(); // Hide "No DSP yet" info
        $("#nav-item-faust-ui").show(); // Show DSP UI tab
        $("#iframe-faust-ui").css("visibility", "visible"); // Show iframe
        $("#output-analyser-ui").show(); // Show dsp info on right panel
        refreshDspUI(node); // update dsp info
        saveEditorDspTable(); // Save the new DSP table to localStorage
        $("#gui-builder-default").hide(); // Hide "No DSP yet" info
        $("#nav-item-gui-builder").show(); // Show DSP UI tab
        $("#iframe-gui-builder").css("visibility", "visible"); // Show iframe
        const guiBuilder = $<HTMLIFrameElement>("#iframe-gui-builder")[0];
        guiBuilder.src = "";
        guiBuilder.src = `PedalEditor/Front-End/index.html?data=${JSON.stringify(node.dspMeta.ui)}&name=${node.dspMeta.filename}`;
        // (guiBuilder.contentWindow as any).faustUI = node.dspMeta.ui;
        // (guiBuilder.contentWindow as any).faustDspMeta = node.dspMeta;
        return { success: true };
    };
    let rtCompileTimer: NodeJS.Timeout;
    /**
     * Save current code to localStorage
     * if realtime compile is on, do compile
     */
    editor.onKeyUp(() => {
        const codeIn = editor.getValue();
        if (localStorage.getItem("faust_editor_code") === codeIn) return;
        if (compileOptions.saveCode) localStorage.setItem("faust_editor_code", codeIn);
        clearTimeout(rtCompileTimer);
        const code = `declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`;
        if (compileOptions.realtimeCompile) rtCompileTimer = setTimeout(audioEnv.dsp ? runDsp : getDiagram, 1000, code);
    });

    const audioEnv: FaustEditorAudioEnv = { dspConnectedToInput: false, dspConnectedToOutput: false, inputEnabled: false, outputEnabled: false };
    const midiEnv: FaustEditorMIDIEnv = { input: null };
    const uiEnv: FaustEditorUIEnv = { analysersInited: false, inputScope: null, outputScope: null, plotScope: undefined, analyser: new Analyser(16, "continuous") };
    const compileOptions: FaustEditorCompileOptions = { name: "untitled", useWorklet: false, bufferSize: 1024, saveCode: true, saveParams: false, saveDsp: false, realtimeCompile: true, popup: false, voices: 0, args: { "-I": "libraries/" }, plotMode: "offline", plot: 256, plotSR: 48000, plotFFT: 256, drawSpectrogram: false, ...loadEditorParams() };
    const faustEnv: FaustEditorEnv = { audioEnv, midiEnv, uiEnv, compileOptions, jQuery, editor, faust };
    uiEnv.plotScope = new StaticScope({ container: $<HTMLDivElement>("#plot-ui")[0] });
    uiEnv.analyser.drawHandler = uiEnv.plotScope.draw;
    uiEnv.analyser.getSampleRate = () => (compileOptions.plotMode === "offline" ? compileOptions.plotSR : audioEnv.audioCtx.sampleRate);

    if (compileOptions.saveDsp) loadEditorDspTable();

    /**
     * Bind DOM events
     */
    // Alerts
    $(".alert>.close").on("click", e => $(e.currentTarget).parent().css("visibility", "hidden"));
    $(".a-alert-faust-code-detail").on("click", e => $("#modal-alert-faust-code-detail .modal-body").text($(e.currentTarget).siblings("span").text()));
    // Tooltips
    $('[data-toggle="tooltip"]').tooltip({ trigger: "hover", boundary: "viewport" });
    $("#btn-export").tooltip({ trigger: "hover", boundary: "viewport" });
    $("#btn-share").tooltip({ trigger: "hover", boundary: "viewport" });
    /**
     * Left panel options
     */
    // Voices
    $<HTMLSelectElement>("#select-voices").on("change", (e) => {
        compileOptions.voices = +e.currentTarget.value;
        saveEditorParams();
        if (compileOptions.realtimeCompile && audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`);
    });
    // BufferSize
    $<HTMLSelectElement>("#select-buffer-size").on("change", (e) => {
        compileOptions.bufferSize = +e.currentTarget.value as 128 | 256 | 512 | 1024 | 2048 | 4096;
        saveEditorParams();
        if (compileOptions.realtimeCompile && audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`);
    });
    // AudioWorklet
    $<HTMLInputElement>("#check-worklet").on("change", (e) => {
        compileOptions.useWorklet = e.currentTarget.checked;
        const $options = $("#select-buffer-size").prop("disabled", true).children("option");
        $options.eq(0).prop("disabled", !compileOptions.useWorklet);
        $("#select-buffer-size").prop("disabled", !!compileOptions.useWorklet);
        if (compileOptions.useWorklet) $options.eq(0).prop("selected", true);
        else $options.eq([128, 256, 512, 1024, 2048, 4096].indexOf(compileOptions.bufferSize)).prop("selected", true);
        $("#input-plot-samps").change();
        saveEditorParams();
        if (compileOptions.realtimeCompile && audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`);
    });
    // Save Params
    $<HTMLInputElement>("#check-save-code").on("change", (e) => {
        compileOptions.saveCode = e.currentTarget.checked;
        saveEditorParams();
    })[0].checked = compileOptions.saveCode;
    // Save Params
    $<HTMLInputElement>("#check-save-params").on("change", (e) => {
        compileOptions.saveParams = e.currentTarget.checked;
        saveEditorParams();
    })[0].checked = compileOptions.saveParams;
    // Save DSP
    $<HTMLInputElement>("#check-save-dsp").on("change", (e) => {
        compileOptions.saveDsp = e.currentTarget.checked;
        loadEditorDspTable();
        saveEditorParams();
    })[0].checked = compileOptions.saveDsp;
    if (compileOptions.saveDsp) loadEditorDspTable();
    // Real-time Diagram
    $<HTMLInputElement>("#check-realtime-compile").on("change", (e) => {
        compileOptions.realtimeCompile = e.currentTarget.checked;
        saveEditorParams();
        if (compileOptions.realtimeCompile) {
            const code = editor.getValue();
            if (audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${code}`);
            else getDiagram(code);
        }
    });
    // Save Params
    $<HTMLInputElement>("#check-popup").on("change", (e) => {
        compileOptions.popup = e.currentTarget.checked;
        saveEditorParams();
    })[0].checked = compileOptions.popup;
    // Plot
    $<HTMLInputElement>("#select-plot-mode").on("change", (e) => {
        compileOptions.plotMode = e.currentTarget.value as "offline" | "continuous" | "onevent" | "manual";
        uiEnv.analyser.drawMode = compileOptions.plotMode;
        const $span = $("#btn-plot").children("span");
        if (compileOptions.plotMode === "offline") {
            $("#btn-plot").show();
            $span.text("Plot First Samples");
        } else if (compileOptions.plotMode === "manual") {
            $("#btn-plot").show();
            $span.text("Plot (Snapshot)");
        } else $("#btn-plot").hide();
        if (compileOptions.plotMode === "continuous") uiEnv.plotScope.mode = 2;
        const $plotSR = $<HTMLInputElement>("#input-plot-sr");
        if (compileOptions.plotMode === "offline") $plotSR.prop("disabled", false)[0].value = compileOptions.plotSR.toString();
        else $plotSR.prop("disabled", true)[0].value = audioEnv.audioCtx ? audioEnv.audioCtx.sampleRate.toString() : "48000";
        saveEditorParams();
    });
    $("#btn-plot").on("click", () => {
        if (compileOptions.plotMode === "offline") {
            const code = editor.getValue();
            const { args, plot, plotSR } = compileOptions;
            faustEnv.faust.plot({ code, args, size: plot, sampleRate: plotSR }).then(t => uiEnv.analyser.plotHandler(t, 0, undefined, true));
            if (!$("#tab-plot-ui").hasClass("active")) $("#tab-plot-ui").tab("show");
        } else { // eslint-disable-next-line no-lonely-if
            if (audioEnv.dsp) uiEnv.analyser.draw();
            else runDsp(`declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`);
        }
    });
    $("#tab-plot-ui").on("shown.bs.tab", () => uiEnv.plotScope.draw());
    $<HTMLInputElement>("#input-plot-samps").on("change", (e) => {
        const v = +e.currentTarget.value;
        const bufferSize = (compileOptions.useWorklet ? 128 : compileOptions.bufferSize);
        const fftSize = compileOptions.plotFFT || 256;
        const step = Math.max(bufferSize, fftSize);
        const v1 = Math.max((v === compileOptions.plot - 1 ? Math.floor(v / step) : Math.ceil(v / step)) * step, step); // Spinner
        compileOptions.plot = v1;
        uiEnv.analyser.buffers = v1 / bufferSize;
        e.currentTarget.value = v1.toString();
        saveEditorParams();
    })[0].value = compileOptions.plot.toString();
    $<HTMLInputElement>("#input-plot-sr").on("change", (e) => {
        const v = +e.currentTarget.value;
        const v1 = Math.max((v === compileOptions.plotSR - 1 ? Math.floor(v / 100) : Math.ceil(v / 100)) * 100, 1); // Spinner
        compileOptions.plotSR = v1;
        e.currentTarget.value = v1.toString();
        saveEditorParams();
    })[0].value = compileOptions.plotSR.toString();
    $<HTMLInputElement>("#check-draw-spectrogram").on("change", (e) => {
        compileOptions.drawSpectrogram = e.currentTarget.checked;
        uiEnv.plotScope.drawSpectrogram = compileOptions.drawSpectrogram;
        uiEnv.inputScope.drawSpectrogram = compileOptions.drawSpectrogram;
        uiEnv.outputScope.drawSpectrogram = compileOptions.drawSpectrogram;
        saveEditorParams();
    })[0].checked = compileOptions.drawSpectrogram;
    // Plot
    $<HTMLInputElement>("#select-plot-fftsize").on("change", (e) => {
        compileOptions.plotFFT = +e.currentTarget.value as 256 | 1024 | 4096;
        uiEnv.analyser.fftSize = compileOptions.plotFFT;
        $("#input-plot-samps").change();
        saveEditorParams();
    });
    /**
     * Load options from URL, override current
     * Available params:
     * {boolean} autorun
     * {boolean} realtime_compile
     * {string} name - as string
     * {string} code - as URL to fetch
     * {string} inline - as Base64URL (should be url safe version)
     * {string} code_string - as string
     * {number} voices - poly voices
     * {number} buffer_size - buffer size
     *
     * @param {string} url
     * @returns
     */
    const loadURLParams = async (url: string) => {
        const urlParams = new URLSearchParams(url);
        if (urlParams.has("realtime_compile")) {
            compileOptions.realtimeCompile = !!+urlParams.get("realtime_compile");
            saveEditorParams();
        }
        if (urlParams.has("voices")) {
            const voices = +urlParams.get("voices");
            compileOptions.voices = [1, 2, 4, 8, 16, 32, 64, 128].indexOf(voices) === -1 ? 0 : voices;
            saveEditorParams();
        }
        if (urlParams.has("buffer_size")) {
            const bufferSize = +urlParams.get("buffer_size");
            compileOptions.bufferSize = [128, 256, 512, 1024, 2048, 4096].indexOf(bufferSize) === -1 ? 1024 : (bufferSize as 128 | 256 | 512 | 1024 | 2048 | 4096);
            saveEditorParams();
        }
        let code;
        if (urlParams.has("code")) {
            const codeURL = urlParams.get("code");
            compileOptions.name = codeURL.split("/").slice(-1)[0].split(".").slice(0, -1).join(".").replace(/[^a-zA-Z0-9_]/g, "") || "untitled";
            $("#input-filename").val(compileOptions.name);
            const response = await fetch(codeURL);
            code = await response.text();
        }
        if (urlParams.has("code_string")) {
            code = urlParams.get("code_string");
        }
        if (urlParams.has("inline")) {
            const b64Code = urlParams.get("inline").replace("-", "+").replace("_", "/");
            code = atob(b64Code);
        }
        if (urlParams.has("name")) {
            const name = urlParams.get("name");
            compileOptions.name = name.replace(/[^a-zA-Z0-9_]/g, "") || "untitled";
            $("#input-filename").val(compileOptions.name);
            saveEditorParams();
        }
        if (code) {
            editor.setValue(code);
            localStorage.setItem("faust_editor_code", code);
            saveEditorParams();
            if (urlParams.has("autorun") && urlParams.get("autorun")) {
                const compileResult = await runDsp(`declare filename "${compileOptions.name}.dsp"; ${code}`);
                if (!compileResult.success) return;
                if (!$("#tab-faust-ui").hasClass("active")) $("#tab-faust-ui").tab("show");
            }
        }
    };
    // Upload
    $("#btn-upload").on("click", () => {
        $("#input-upload").click();
    });
    $<HTMLInputElement>("#input-upload").on("input", (e) => {
        const file = e.currentTarget.files[0];
        const reader = new FileReader();
        reader.onload = () => {
            compileOptions.name = file.name.split(".").slice(0, -1).join(".").replace(/[^a-zA-Z0-9_]/g, "") || "untitled";
            $("#input-filename").val(compileOptions.name);
            const code = reader.result.toString();
            editor.setValue(code);
            localStorage.setItem("faust_editor_code", code);
            saveEditorParams();
            if (compileOptions.realtimeCompile) {
                if (audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${code}`);
                else getDiagram(code);
            }
        };
        reader.onerror = () => undefined;
        reader.readAsText(file);
    }).on("click", e => e.stopPropagation());
    // Save as
    $("#btn-save").on("click", () => {
        const text = editor.getValue();
        const uri = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
        $("#a-save").attr({ href: uri, download: compileOptions.name + ".dsp" })[0].click();
    });
    $("#a-save").on("click", e => e.stopPropagation());
    // Docs
    $("#btn-docs").on("click", () => $("#a-docs")[0].click());
    $("#a-docs").on("click", e => e.stopPropagation());
    /**
     * Export
     * Append options to export model
     */
    const server = "https://faustservicecloud.grame.fr";
    const getTargets = (server: string) => {
        $("#export-platform").add("#export-arch").empty();
        $("#export-platform").off("change");
        $("#export-download").off("click");
        $("#a-export-download").off("click");
        $("#export-submit").prop("disabled", true).off("click");
        fetch(`${server}/targets`)
            .then(response => response.json())
            .then((targets: FaustExportTargets) => {
                const plats = Object.keys(targets);
                if (plats.length) {
                    plats.forEach((plat, i) => $("#export-platform").append(new Option(plat, plat, i === 0)));
                    targets[plats[0]].forEach((arch, i) => $("#export-arch").append(new Option(arch, arch, i === 0)));
                }
                $("#modal-export").on("shown.bs.modal", () => $("#export-name").val(compileOptions.name));
                $("#export-name").on("keydown", (e) => {
                    if (e.key.match(/[^a-zA-Z0-9_]/)) e.preventDefault();
                });
                $<HTMLSelectElement>("#export-platform").on("change", (e) => {
                    const plat = e.currentTarget.value;
                    $("#export-arch").empty();
                    targets[plat].forEach((arch, i) => $("#export-arch").append(new Option(arch, arch, i === 0)));
                });
                $("#export-download").on("click", () => $("#a-export-download")[0].click());
                $("#a-export-download").on("click", e => e.stopPropagation());
                $("#export-submit").prop("disabled", false).on("click", () => {
                    $("#export-download").hide();
                    $("#export-loading").css("display", "inline-block");
                    $("#qr-code").hide();
                    $("#export-error").hide();
                    const form = new FormData();
                    const name = ($("#export-name").val() as string).replace(/[^a-zA-Z0-9_]/g, "") || "untitled";
                    form.append("file", new File([`declare filename "${name}.dsp"; ${editor.getValue()}`], `${name}.dsp`));
                    $.ajax({
                        method: "POST",
                        url: `${server}/filepost`,
                        data: form,
                        contentType: false,
                        processData: false
                    }).done((shaKey) => {
                        const matched = shaKey.match(/^[0-9A-Fa-f]+$/);
                        if (matched) {
                            const plat = $("#export-platform").val();
                            const arch = $("#export-arch").val();
                            const path = `${server}/${shaKey}/${plat}/${arch}`;
                            $.ajax({
                                method: "GET",
                                url: `${path}/precompile`
                            }).done((result) => {
                                if (result === "DONE") {
                                    const href = `${path}/${plat === "android" ? "binary.apk" : "binary.zip"}`;
                                    $("#a-export-download").attr({ href });
                                    $("#export-download").show();
                                    $("#qr-code").show();
                                    QRCode.toCanvas(
                                        $<HTMLCanvasElement>("#qr-code")[0],
                                        `${path}/${plat === "android" ? "binary.apk" : "binary.zip"}`,
                                    );
                                    return;
                                }
                                $("#export-loading").css("display", "none");
                                $("#export-error").html(result).show();
                            }).fail((jqXHR, textStatus) => {
                                $("#export-error").html(textStatus + ": " + jqXHR.responseText).show();
                            }).always(() => $("#export-loading").css("display", "none"));
                            return;
                        }
                        $("#export-loading").css("display", "none");
                        $("#export-error").html(shaKey).show();
                    }).fail((jqXHR, textStatus) => {
                        $("#export-loading").css("display", "none");
                        $("#export-error").html(textStatus + ": " + jqXHR.responseText).show();
                    });
                });
            });
    };
    $<HTMLInputElement>("#export-server").val(server).on("change", e => getTargets(e.currentTarget.value)).change();
    // Share
    /**
     * Make share URL with options
     *
     * @returns
     */
    const makeURL = () => {
        const base = window.location.origin + window.location.pathname;
        const urlParams = new URLSearchParams();
        urlParams.set("autorun", $("#share-autorun").prop("checked") ? "1" : "0");
        urlParams.set("voices", compileOptions.voices.toString());
        urlParams.set("name", compileOptions.name);
        urlParams.set("inline", btoa(editor.getValue()).replace("+", "-").replace("/", "_"));
        return base + "?" + urlParams.toString();
    };
    $("#modal-share").on("shown.bs.modal", () => {
        $("#share-btn-copy").html("Copy");
        $("#share-url").val(makeURL());
    });
    $("#share-autorun").on("change", () => {
        $("#share-btn-copy").html("Copy");
        $("#share-url").val(makeURL());
    });
    $("#share-btn-copy").on("click", (e) => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText($("#share-url").val() as string);
        } else {
            $("#share-url").focus().select();
            document.execCommand("copy");
        }
        $(e.currentTarget).html('<i class="fas fa-check"></i>');
    });
    /**
     * Right panel options
     */
    // Keyboard as midi input
    const key2Midi = new Key2Midi({ keyMap: navigator.language === "fr-FR" ? Key2Midi.KEY_MAP_FR : Key2Midi.KEY_MAP, enabled: false });
    $(document).on("keydown", (e) => {
        if (faustEnv.editor && faustEnv.editor.hasTextFocus()) return;
        key2Midi.handleKeyDown(e.key);
    });
    $(document).on("keyup", (e) => {
        if (faustEnv.editor && faustEnv.editor.hasTextFocus()) return;
        key2Midi.handleKeyUp(e.key);
    });
    // MIDI Devices select
    $<HTMLSelectElement>("#select-midi-input").on("change", (e) => {
        const id = e.currentTarget.value;
        if (midiEnv.input) midiEnv.input.removeListener("midimessage", "all");
        const keys: number[] = [];
        const listener = (data: number[] | Uint8Array) => {
            if (audioEnv.dsp) audioEnv.dsp.midiMessage(data); // Send midi message to dsp node
            if (data[0] === 144) { // Show as pill midi note
                if (data[2]) {
                    if (keys.indexOf(data[1]) === -1) keys.push(data[1]);
                    $("#midi-ui-note").text(data[1]).show();
                } else {
                    keys.splice(keys.indexOf(data[1]), 1);
                    if (keys.length === 0) $("#midi-ui-note").hide();
                    else $("#midi-ui-note").text(keys[keys.length - 1]);
                }
            }
        };
        if (id === "-2") {
            key2Midi.handler = listener;
            key2Midi.enabled = true;
            return;
        }
        key2Midi.enabled = false;
        if (id === "-1") return;
        const input = webmidi.getInputById(id);
        if (!input) return;
        midiEnv.input = input;
        input.addListener("midimessage", "all", e => listener(e.data));
    });
    // Append current connected devices
    const handleMIDIConnect = (e: WebMidiEventConnected) => {
        if (e.port.type !== "input") return;
        const $select = $("#select-midi-input");
        if ($select.find(`option[value="${e.port.id}"]`).length) return;
        const $option = $(new Option(e.port.name, e.port.id));
        $select.append($option);
        $option.prop("selected", true).change();
    };
    const handleMIDIDisconnect = (e: WebMidiEventDisconnected) => {
        if (e.port.type !== "input") return;
        const $select = $("#select-midi-input");
        const $find = $select.find(`option[value="${e.port.id}"]`);
        if (!$find.length) return;
        $find.remove();
        $select.children("option").last().prop("selected", true).change();
    };
    $("#select-midi-input").children("option").eq(1).prop("selected", true).change();
    webmidi.enable((e) => {
        if (e) return;
        $("#midi-ui-default").hide();
        $("#select-midi-input").prop("disabled", false);
        webmidi.addListener("connected", handleMIDIConnect);
        webmidi.addListener("disconnected", handleMIDIDisconnect);
    });
    /**
     * Audio Inputs
     * Use WaveSurfer lib with MediaElement and <audio />
     */
    let wavesurfer: WaveSurfer;
    $<HTMLSelectElement>("#select-audio-input").on("change", async (e) => {
        const id = e.currentTarget.value;
        if (audioEnv.currentInput === id) return;
        if (audioEnv.audioCtx) {
            const splitter = audioEnv.splitterInput;
            const dsp = audioEnv.dsp;
            const input = audioEnv.inputs[audioEnv.currentInput];
            if (splitter) input.disconnect(splitter);
            if (dsp && audioEnv.dspConnectedToInput && dsp.getNumInputs()) { // Disconnect
                input.disconnect(dsp);
                audioEnv.dspConnectedToInput = false;
            }
        }
        // MediaElementSource, Waveform
        if (id === "-1") {
            $("#source-ui").show();
            $("#input-analyser-ui").hide();
        } else {
            $("#source-ui").hide();
            $("#input-analyser-ui").show();
        }
        await initAudioCtx(audioEnv);
        initAnalysersUI(uiEnv, audioEnv);
        if (!wavesurfer) {
            wavesurfer = WaveSurfer.create({
                container: $("#source-waveform")[0],
                audioContext: audioEnv.audioCtx,
                backend: "MediaElement",
                cursorColor: "#EEE",
                progressColor: "#888",
                waveColor: "#BBB",
                height: 60,
                splitChannels: true
            });
            wavesurfer.on("play", () => {
                $("#btn-source-play .fa-play").removeClass("fa-play").addClass("fa-pause");
                $("#input-analyser-ui").show();
            });
            wavesurfer.on("pause", () => {
                $("#btn-source-play .fa-pause").removeClass("fa-pause").addClass("fa-play");
                $("#input-analyser-ui").hide();
            });
            wavesurfer.on("finish", () => {
                if ($("#btn-source-loop").hasClass("active")) wavesurfer.play();
                else {
                    $("#btn-source-play .fa-pause").removeClass("fa-pause").addClass("fa-play");
                    $("#input-analyser-ui").hide();
                }
            });
            wavesurfer.load("./02-XYLO1.mp3");
            if ($("#source-waveform audio").length) {
                audioEnv.inputs[-1] = audioEnv.audioCtx.createMediaElementSource($<HTMLAudioElement>("#source-waveform audio")[0]);
            }
        }
        // init audio environment and connect to dsp if necessary
        await initAudioCtx(audioEnv, id);
        const splitter = audioEnv.splitterInput;
        const dsp = audioEnv.dsp;
        const input = audioEnv.inputs[id];
        audioEnv.currentInput = id;
        audioEnv.inputEnabled = true;
        if (splitter) input.connect(splitter);
        if (dsp && dsp.getNumInputs()) {
            input.connect(dsp);
            audioEnv.dspConnectedToInput = true;
        }
    }).change();
    /**
     * Audio Outputs
     * Choose and audio stream <audio />
     */
    $<HTMLSelectElement>("#select-audio-output").on("change", async (e) => {
        if (!supportMediaStreamDestination) return;
        const id = e.currentTarget.value;
        await initAudioCtx(audioEnv);
        const audio = $<HTMLAudioElement>("#output-audio-stream")[0];
        audio.setSinkId(id);
    }).change();
    // Waveform
    $("#btn-source-play").on("click", () => {
        if (!wavesurfer || !wavesurfer.isReady) return;
        if (wavesurfer.isPlaying()) {
            wavesurfer.pause();
        } else {
            wavesurfer.play();
        }
    });
    $("#btn-source-rewind").on("click", () => {
        if (!wavesurfer.isReady) return;
        wavesurfer.seekTo(0);
    });
    $("#btn-source-loop").on("click", (e) => {
        $(e.currentTarget).toggleClass("active");
    });
    // Waveform drag'n'drop
    $("#source-waveform").on("dragenter dragover", (e) => {
        const event = e.originalEvent as DragEvent;
        if (event.dataTransfer && event.dataTransfer.items.length && event.dataTransfer.items[0].kind === "file") {
            e.preventDefault();
            e.stopPropagation();
            $("#source-overlay").show();
        }
    });
    $("#source-overlay").on("dragleave dragend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $(e.currentTarget).hide();
    });
    $("#source-overlay").on("dragenter dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    $("#source-overlay").on("drop", (e) => {
        $(e.currentTarget).hide();
        if (!wavesurfer.isReady) return;
        const event = e.originalEvent as DragEvent;
        if (event.dataTransfer && event.dataTransfer.files.length) {
            // Stop the propagation of the event
            e.preventDefault();
            e.stopPropagation();
            const splitter = audioEnv.splitterInput;
            const analyser = audioEnv.analyserInput;
            const dsp = audioEnv.dsp;
            let input = audioEnv.inputs[-1];
            if (analyser && input) input.disconnect(splitter);
            if (dsp && audioEnv.dspConnectedToInput && dsp.getNumInputs()) { // Disconnect
                input.disconnect(dsp);
                audioEnv.dspConnectedToInput = false;
            }
            audioEnv.inputEnabled = false;

            const file = event.dataTransfer.files[0];
            try {
                wavesurfer.load(URL.createObjectURL(file));
            } catch (e) {
                console.error(e); // eslint-disable-line no-console
                showError("Cannot load sound file: " + e);
                return;
            }
            if ($("#source-waveform audio").length) {
                audioEnv.inputs[-1] = audioEnv.audioCtx.createMediaElementSource($<HTMLAudioElement>("#source-waveform audio")[0]);
                input = audioEnv.inputs[-1];
            }
            audioEnv.inputEnabled = true;
            if (analyser && input) input.connect(splitter);
            if (dsp && dsp.getNumInputs()) {
                input.connect(dsp);
                audioEnv.dspConnectedToInput = true;
            }
        }
    });
    // Append connected audio devices
    const handleMediaDeviceChange = () => {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
            const $selectInput = $("#select-audio-input");
            const $selectOutput = $("#select-audio-output");
            $selectInput.children("option").each((i, e: HTMLOptionElement) => {
                if (e.value === "-1") return;
                if (!devices.find(device => device.deviceId === e.value && device.kind === "audioinput")) {
                    e.remove();
                    if (e.selected) $selectInput.find("option").eq(0).prop("selected", true).change();
                }
            });
            $selectOutput.children("option").each((i, e: HTMLOptionElement) => {
                if (e.value === "-1") return;
                if (!devices.find(device => device.deviceId === e.value && device.kind === "audiooutput")) {
                    e.remove();
                    if (e.selected) $selectOutput.find("option").eq(0).prop("selected", true).change();
                }
            });
            devices.forEach((device) => {
                if (device.kind === "audioinput") {
                    if ($selectInput.find(`option[value=${device.deviceId}]`).length) return;
                    $selectInput.append(new Option(device.label || device.deviceId, device.deviceId));
                }
                if (supportMediaStreamDestination && device.kind === "audiooutput") {
                    if ($selectOutput.find(`option[value=${device.deviceId}]`).length) return;
                    $selectOutput.append(new Option(device.label || device.deviceId, device.deviceId));
                }
            });
        });
    };
    if (navigator.mediaDevices) {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
            $("#input-ui-default").hide();
            const $selectInput = $("#select-audio-input").prop("disabled", false);
            let $selectOutput: JQuery<HTMLElement>;
            if (supportMediaStreamDestination) {
                if (devices.find(device => device.kind === "audiooutput")) {
                    $("#output-ui-default").hide();
                    $selectOutput = $("#select-audio-output").prop("disabled", false);
                } else { // No audio outputs, fallback to audioCtx.destination
                    if (audioEnv.audioCtx && audioEnv.destination) audioEnv.destination = audioEnv.audioCtx.destination;
                    supportMediaStreamDestination = false;
                }
            }
            navigator.mediaDevices.ondevicechange = handleMediaDeviceChange;
            devices.forEach((device) => {
                if (device.kind === "audioinput") {
                    $selectInput.append(new Option(device.label || device.deviceId, device.deviceId));
                }
                if (supportMediaStreamDestination && device.kind === "audiooutput") {
                    $selectOutput.append(new Option(device.label || device.deviceId, device.deviceId));
                }
            });
        });
    }
    // DSP info
    refreshDspUI();
    if (supportAudioWorklet) { // Switch between AW / SP nodes
        $("#dsp-ui-default").on("click", (e) => {
            if (!$(e.currentTarget).hasClass("switch")) return;
            $<HTMLInputElement>("#check-worklet")[0].checked = !compileOptions.useWorklet;
            $("#check-worklet").change();
            if (!compileOptions.realtimeCompile) runDsp(`declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`);
        });
    } else $("#dsp-ui-default").tooltip("disable").css("pointer-events", "none");
    // Output switch to connect / disconnect dsp form destination
    $(".btn-dac").on("click", async () => {
        /*
        if (!audioEnv.audioCtx) {
            await initAudioCtx(audioEnv);
            $(e.currentTarget).removeClass("btn-light").addClass("btn-primary")
            .children("span").html("Output is On");
        } else if (audioEnv.audioCtx.state === "suspended") {
            audioEnv.audioCtx.resume();
            $(e.currentTarget).removeClass("btn-light").addClass("btn-primary")
            .children("span").html("Output is On");
        } else {
            audioEnv.audioCtx.suspend();
            $(e.currentTarget).removeClass("btn-primary").addClass("btn-light")
            .children("span").html("Output is Off");
        }
        */
        if (audioEnv.outputEnabled) {
            $(".btn-dac").removeClass("btn-primary").addClass("btn-light")
                .children("span").html("Output is Off");
            audioEnv.outputEnabled = false;
            if (audioEnv.dspConnectedToOutput) {
                audioEnv.dsp.disconnect(audioEnv.destination);
                audioEnv.dspConnectedToOutput = false;
            }
        } else {
            audioEnv.outputEnabled = true;
            if (!audioEnv.audioCtx) {
                await initAudioCtx(audioEnv);
                initAnalysersUI(uiEnv, audioEnv);
            } else if (audioEnv.dsp) {
                audioEnv.dsp.connect(audioEnv.destination);
                audioEnv.dspConnectedToOutput = true;
            }
            $(".btn-dac").removeClass("btn-light").addClass("btn-primary")
                .children("span").html("Output is On");
        }
    });
    /**
     * Center
     */
    // File Drag and drop
    $("#top").on("dragenter dragover", (e) => {
        const event = e.originalEvent as DragEvent;
        if (event.dataTransfer && event.dataTransfer.items.length && event.dataTransfer.items[0].kind === "file") {
            e.preventDefault();
            e.stopPropagation();
            $("#editor-overlay").show();
        }
    });
    $("#editor-overlay").on("dragleave dragend", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $(e.currentTarget).hide();
    });
    $("#editor-overlay").on("dragenter dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    $("#editor-overlay").on("drop", (e) => {
        $(e.currentTarget).hide();
        const event = e.originalEvent as DragEvent;
        if (event.dataTransfer && event.dataTransfer.files.length) {
            // Stop the propagation of the event
            e.preventDefault();
            e.stopPropagation();
            const file = event.dataTransfer.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                // Update filename
                compileOptions.name = file.name.split(".").slice(0, -1).join(".").replace(/[^a-zA-Z0-9_]/g, "") || "untitled";
                $("#input-filename").val(compileOptions.name);
                const code = reader.result.toString();
                editor.setValue(code);
                // save code to localStorage
                localStorage.setItem("faust_editor_code", code);
                saveEditorParams();
                // compile diagram or dsp if necessary
                if (compileOptions.realtimeCompile) {
                    if (audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${code}`);
                    else getDiagram(code);
                }
            };
            reader.onerror = () => undefined;
            reader.readAsText(file);
        }
    });
    // Update filename on change
    $("#input-filename").val(compileOptions.name).on("keydown", (e) => {
        if (e.key.match(/[^a-zA-Z0-9_]/)) e.preventDefault();
    }).on("keyup", (e) => {
        compileOptions.name = ($(e.currentTarget).val() as string).replace(/[^a-zA-Z0-9_]/g, "") || "untitled";
        $(e.currentTarget).val(compileOptions.name);
        saveEditorParams();
        if (compileOptions.realtimeCompile && audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`);
    });
    // Examples
    type DirectoryTree = {
        path: string;
        name: string;
        size: number;
        type: "directory" | "file";
        children?: DirectoryTree[];
        extension?: string;
    };
    // Append each file in examples.json to div menu
    fetch("./examples.json")
        .then(response => response.json())
        .then((tree: DirectoryTree) => {
            const $menu = $("#tab-examples");
            const parseTree = (treeIn: DirectoryTree, $menu: JQuery<HTMLElement>) => {
                if (treeIn.type === "file") {
                    const $item = $("<a>").addClass(["dropdown-item", "faust-example"]).attr("href", "#").text(treeIn.name).data("path", treeIn.path);
                    $menu.append($item);
                } else {
                    const $item = $("<div>").addClass(["dropright", "submenu"]);
                    const $a = $("<a>").addClass(["dropdown-item", "dropdown-toggle", "submenu-toggle"]).attr("href", "#").text(treeIn.name);
                    const $submenu = $("<div>").addClass("dropdown-menu");
                    $item.append($a, $submenu);
                    treeIn.children.forEach(v => parseTree(v, $submenu));
                    $menu.append($item);
                    $a.dropdown();
                }
            };
            if (tree.children) tree.children.forEach(v => parseTree(v, $menu));
        });
    // Load an example
    $("#tab-examples").on("click", ".faust-example", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const path = $(e.currentTarget).data("path");
        const name = $(e.currentTarget).text();
        if (path) {
            fetch("../" + path)
                .then(response => response.text())
                .then((code) => {
                    compileOptions.name = name.split(".").slice(0, -1).join(".").replace(/[^a-zA-Z0-9_]/g, "") || "untitled";
                    $("#input-filename").val(compileOptions.name);
                    editor.setValue(code);
                    localStorage.setItem("faust_editor_code", code);
                    saveEditorParams();
                    if (compileOptions.realtimeCompile) {
                        if (audioEnv.dsp) runDsp(`declare filename "${compileOptions.name}.dsp"; ${code}`);
                        else getDiagram(code);
                    }
                });
        }
        $("#tab-examples").dropdown("toggle");
    });
    // Run Dsp Button
    $(".btn-run").prop("disabled", false).on("click", async () => {
        const compileResult = await runDsp(`declare filename "${compileOptions.name}.dsp"; ${editor.getValue()}`);
        if (!compileResult.success) return;
        if ($("#tab-diagram").hasClass("active") || compileOptions.plotMode === "offline") $("#tab-faust-ui").tab("show");
        // const dspOutputHandler = FaustUI.main(node.getJSON(), $("#faust-ui"), (path: string, val: number) => node.setParamValue(path, val));
        // node.setOutputParamHandler(dspOutputHandler);
    });
    /**
     * Bind message event for changing dsp params on receiving msg from ui window
     */
    const dspParams: { [path: string]: number } = {};
    $(window).on("message", ($e) => {
        const e = $e.originalEvent as MessageEvent;
        if (!e.data) return;
        const data = e.data;
        if (!data.type) return;
        if (data.type === "param") {
            if (audioEnv.dsp) audioEnv.dsp.setParamValue(data.path, +data.value);
            if (compileOptions.saveParams) {
                dspParams[data.path] = +data.value;
                localStorage.setItem("faust_editor_dsp_params", JSON.stringify(dspParams));
            }
            const msg = { path: data.path, value: +data.value, type: "param" };
            (e.source as WindowProxy).postMessage(msg, "*");
            if (uiEnv.uiPopup) uiEnv.uiPopup.postMessage(msg, "*");
            return;
        }
        // Pass keyboard midi messages even inner window is focused
        if (data.type === "keydown") key2Midi.handleKeyDown(data.key);
        else if (data.type === "keyup") key2Midi.handleKeyUp(data.key);
        // From GUI Builder
        else if (data.type === "export") {
            const form = new FormData();
            const name = compileOptions.name;
            const plat = data.plat || "web";
            const arch = data.arch || "wap";
            form.append("file", new File([`declare filename "${name}.dsp"; ${editor.getValue()}`], `${name}.dsp`));
            $.ajax({
                method: "POST",
                url: `${server}/filepost`,
                data: form,
                contentType: false,
                processData: false
            }).done((shaKey) => {
                const matched = shaKey.match(/^[0-9A-Fa-f]+$/);
                if (matched) {
                    const path = `${server}/${shaKey}/${plat}/${arch}`;
                    $.ajax({
                        method: "GET",
                        url: `${path}/precompile`
                    }).done((result) => {
                        if (result === "DONE") {
                            const href = `${path}/binary.zip`;
                            (e.source as WindowProxy).postMessage({ type: "exported", href }, "*");
                        }
                    }).fail((jqXHR, textStatus) => {
                        console.error(textStatus + ": " + jqXHR.responseText);
                    });
                }
            }).fail((jqXHR, textStatus) => {
                console.error(textStatus + ": " + jqXHR.responseText);
            });
        }
    });
    // Close DSP UI Popup when main window is closed
    $(window).on("beforeunload", () => (uiEnv.uiPopup ? uiEnv.uiPopup.close() : undefined));
    $("#nav-item-faust-ui .btn-close-tab").on("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (audioEnv.dsp) { // Disconnect current
            const input = audioEnv.inputs[audioEnv.currentInput];
            const dsp = audioEnv.dsp;
            if (audioEnv.dspConnectedToInput) {
                input.disconnect(dsp);
                audioEnv.dspConnectedToInput = false;
            }
            dsp.disconnect();
            audioEnv.dspConnectedToOutput = false;
            delete audioEnv.dsp;
        }
        if ($("#tab-faust-ui").hasClass("active")) $("#tab-diagram").tab("show");
        $("#nav-item-faust-ui").hide();
        const msg = { type: "clear" };
        const uiWindow = $<HTMLIFrameElement>("#iframe-faust-ui")[0].contentWindow;
        uiWindow.postMessage(msg, "*");
        if (uiEnv.uiPopup) {
            uiEnv.uiPopup.postMessage(msg, "*");
            uiEnv.uiPopup.close();
        }
        $("#faust-ui-default").show();
        $("#iframe-faust-ui").css("visibility", "hidden");
        $("#output-analyser-ui").hide();
        refreshDspUI();
    });
    let svgDragged = false;
    // svg inject
    $<SVGAElement>("#diagram-svg").on("click", "a", (e) => {
        e.preventDefault();
        if (svgDragged) return;
        // const $svg = $("#diagram-svg>svg");
        // const curWidth = $svg.length ? $svg.width() : $("#diagram").width(); // preserve current zoom
        const fileName = e.currentTarget.href.baseVal;
        const strSvg = faust.fs.readFile("FaustDSP-svg/" + fileName, { encoding: "utf8" });
        const svg = $<SVGSVGElement>(strSvg).filter("svg")[0];
        const width = Math.min($("#diagram").width(), $("#diagram").height() / svg.height.baseVal.value * svg.width.baseVal.value);
        $("#diagram-svg").empty().append(svg).children("svg").width(width); // replace svg;
    });
    // svg zoom
    $("#diagram-svg").on("mousedown", "svg", (e) => {
        e.preventDefault();
        e.stopPropagation();
        svgDragged = false;
        const $div = $(e.currentTarget).parent();
        const x = e.pageX;
        const y = e.pageY;
        const sL = $div.scrollLeft();
        const sT = $div.scrollTop();
        const handleMouseMove = (e: JQuery.MouseMoveEvent) => {
            if (!e.originalEvent.movementX && !e.originalEvent.movementY) return;
            svgDragged = true;
            const dX = e.pageX - x;
            const dY = e.pageY - y;
            $div.scrollLeft(sL - dX);
            $div.scrollTop(sT - dY);
            e.preventDefault();
            e.stopPropagation();
        };
        const handleMouseUp = (e: JQuery.MouseUpEvent) => {
            $(document).off("mousemove", handleMouseMove);
            $(document).off("mouseup", handleMouseUp);
            if (!svgDragged) return;
            e.preventDefault();
            e.stopPropagation();
        };
        $(document).on("mousemove", handleMouseMove);
        $(document).on("mouseup", handleMouseUp);
    });
    $("#diagram").on("wheel", (e) => {
        if (!e.ctrlKey) return;
        const $svg = $(e.currentTarget).find("svg");
        if (!$svg.length) return;
        e.preventDefault();
        e.stopPropagation();
        const d = (e.originalEvent as WheelEvent).deltaY > 0 ? 1 : -1;
        const w = $svg.width();
        $svg.width(w * (1 - d * 0.25));
    });
    // Analysers
    $("#output-analyser-ui").hide();
    // Keys
    $(document).on("keydown", (e) => {
        if (e.ctrlKey) {
            if (e.key === "d") {
                e.preventDefault();
                e.stopPropagation();
                $("#btn-docs")[0].click();
                return;
            }
            if (e.key === "r") {
                e.preventDefault();
                e.stopPropagation();
                $("#btn-run").click();
            }
        }
    });
    // Resizables
    $(".resizable").on("mousedown touchstart", (e: JQuery.TouchStartEvent | JQuery.MouseDownEvent) => {
        if (e.originalEvent instanceof MouseEvent) {
            e.preventDefault();
            e.stopPropagation();
        }
        $("#iframe-faust-ui").css("pointer-events", "none");
        const $div = $(e.currentTarget).parent();
        const x = typeof e.pageX === "number" ? e.pageX : e.touches[0].pageX;
        const y = typeof e.pageY === "number" ? e.pageY : e.touches[0].pageY;
        const w = $div.width();
        const h = $div.height();
        const modes: string[] = [];
        if ($(e.currentTarget).hasClass("resizable-left")) modes.push("left");
        if ($(e.currentTarget).hasClass("resizable-right")) modes.push("right");
        if ($(e.currentTarget).hasClass("resizable-top")) modes.push("top");
        if ($(e.currentTarget).hasClass("resizable-bottom")) modes.push("bottom");
        const handleMouseMove = (e: JQuery.TouchMoveEvent | JQuery.MouseMoveEvent) => {
            if (e.originalEvent instanceof MouseEvent) {
                e.preventDefault();
                e.stopPropagation();
            }
            const dX = (typeof e.pageX === "number" ? e.pageX : e.touches[0].pageX) - x;
            const dY = (typeof e.pageY === "number" ? e.pageY : e.touches[0].pageY) - y;
            if (modes.indexOf("left") !== -1) $div.width(w - dX);
            if (modes.indexOf("right") !== -1) $div.width(w + dX);
            if (modes.indexOf("top") !== -1) $div.height(h - dY);
            if (modes.indexOf("bottom") !== -1) $div.height(h + dY);
            if (editor) editor.layout();
            if (wavesurfer.isReady && wavesurfer.drawer.containerWidth !== wavesurfer.drawer.container.clientWidth) {
                wavesurfer.drawer.containerWidth = wavesurfer.drawer.container.clientWidth;
                wavesurfer.drawBuffer();
            }
        };
        const handleMouseUp = (e: JQuery.TouchEndEvent | JQuery.MouseUpEvent) => {
            if (e.originalEvent instanceof MouseEvent) {
                e.preventDefault();
                e.stopPropagation();
            }
            $("#iframe-faust-ui").css("pointer-events", "");
            $(document).off("mousemove touchmove", handleMouseMove);
            $(document).off("mouseup", handleMouseUp);
        };
        $(document).on("mousemove touchmove", handleMouseMove);
        $(document).on("mouseup touchend", handleMouseUp);
    });
    // Panels
    $(".btn-show-left").on("click", (e) => {
        if ($(e.currentTarget).hasClass("active")) {
            $("#left").hide();
            $(".btn-show-left").removeClass(["btn-primary", "active"]).addClass("btn-outline-secondary");
        } else {
            $("#left").show();
            $(".btn-show-left").addClass(["btn-primary", "active"]).removeClass("btn-outline-secondary");
        }
        editor.layout();
    });
    $(".btn-show-right").on("click", (e) => {
        if ($(e.currentTarget).hasClass("active")) {
            $("#right").hide();
            $(".btn-show-right").removeClass(["btn-primary", "active"]).addClass("btn-outline-secondary");
        } else {
            $("#right").show();
            $(".btn-show-right").addClass(["btn-primary", "active"]).removeClass("btn-outline-secondary");
        }
        editor.layout();
    });
    $(window).on("resize", () => {
        if (window.innerWidth <= 900) {
            $("#right").add("#left").hide();
            $(".btn-show-right").add(".btn-show-left").removeClass(["btn-primary", "active"]).addClass("btn-outline-secondary");
        } else {
            $("#right").add("#left").show();
            $(".btn-show-right").add(".btn-show-left").addClass(["btn-primary", "active"]).removeClass("btn-outline-secondary");
        }
    }).resize();
    // autorunning
    await loadURLParams(window.location.search);
    $("#select-voices").children(`option[value=${compileOptions.voices}]`).prop("selected", true);
    $("#select-buffer-size").children(`option[value=${compileOptions.bufferSize}]`).prop("selected", true);
    if (supportAudioWorklet) $("#check-worklet").prop({ disabled: false, checked: true }).change();
    $("#select-plot-mode").children(`option[value=${compileOptions.plotMode}]`).prop("selected", true).change();
    $("#select-plot-fftsize").children(`option[value=${compileOptions.plotFFT}]`).prop("selected", true).change();
    $("#input-plot-samps").change();
    $("#check-draw-spectrogram").change();
    $<HTMLInputElement>("#check-realtime-compile")[0].checked = compileOptions.realtimeCompile;
    if (compileOptions.realtimeCompile && !audioEnv.dsp) setTimeout(getDiagram, 0, editor.getValue());
    window.faustEnv = faustEnv;
});
/**
 * Init audio environment, audioNodes
 *
 * @param {FaustEditorAudioEnv} audioEnv
 * @param {string} [deviceId]
 * @returns
 */
const initAudioCtx = async (audioEnv: FaustEditorAudioEnv, deviceId?: string) => {
    if (!audioEnv.audioCtx) {
        const audioCtx = new (window.webkitAudioContext || window.AudioContext)();
        audioEnv.audioCtx = audioCtx;
        audioEnv.outputEnabled = true;
        audioCtx.addEventListener("statechange", () => {
            if (audioCtx.state === "running") {
                $(".btn-dac").removeClass("btn-light").addClass("btn-primary")
                    .children("span").html("Output is On");
            } else {
                $(".btn-dac").removeClass("btn-primary").addClass("btn-light")
                    .children("span").html("Output is Off");
            }
        });
        const unlockAudioContext = () => {
            if (audioCtx.state !== "suspended") return;
            const unlock = (): any => audioCtx.resume().then(clean);
            // const unlock = (): any => audioCtx.resume().then(() => $<HTMLAudioElement>("#output-audio-stream")[0].play()).then(clean);
            const clean = () => $("body").off("touchstart touchend mousedown keydown", unlock);
            $("body").on("touchstart touchend mousedown keydown", unlock);
        };
        unlockAudioContext();
    }
    if (audioEnv.audioCtx.state !== "running") audioEnv.audioCtx.resume();
    if (!audioEnv.inputs) audioEnv.inputs = {};
    if (deviceId && !audioEnv.inputs[deviceId]) {
        if (deviceId === "-1") {
            if ($("#source-waveform audio").length) audioEnv.inputs[deviceId] = audioEnv.audioCtx.createMediaElementSource($<HTMLAudioElement>("#source-waveform audio")[0]);
        } else {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId } });
            audioEnv.inputs[deviceId] = audioEnv.audioCtx.createMediaStreamSource(stream);
        }
    }
    if (!audioEnv.splitterInput) audioEnv.splitterInput = audioEnv.audioCtx.createChannelSplitter(2);
    if (!audioEnv.analyserInput) audioEnv.analyserInput = audioEnv.audioCtx.createAnalyser();
    if (!audioEnv.analyserOutput) audioEnv.analyserOutput = audioEnv.audioCtx.createAnalyser();
    audioEnv.splitterInput.connect(audioEnv.analyserInput, 0);
    if (!audioEnv.destination) {
        audioEnv.destination = audioEnv.audioCtx.destination;
        /*
        if (supportMediaStreamDestination) {
            audioEnv.destination = audioEnv.audioCtx.createMediaStreamDestination();
            const audio = $("#output-audio-stream")[0] as HTMLAudioElement;
            if ("srcObject" in audio) audio.srcObject = audioEnv.destination.stream;
            else (audio as HTMLAudioElement).src = URL.createObjectURL(audioEnv.destination.stream);
        } else {
            audioEnv.destination = audioEnv.audioCtx.destination;
        }
        */
        audioEnv.destination.channelInterpretation = "discrete";
    }
    return audioEnv;
};
/**
 * Init analyser scopes with audio environment
 *
 * @param {FaustEditorUIEnv} uiEnv
 * @param {FaustEditorAudioEnv} audioEnv
 * @returns
 */
const initAnalysersUI = (uiEnv: FaustEditorUIEnv, audioEnv: FaustEditorAudioEnv) => {
    if (uiEnv.analysersInited) return;
    uiEnv.inputScope = new Scope({
        audioCtx: audioEnv.audioCtx,
        analyser: audioEnv.analyserInput,
        splitter: audioEnv.splitterInput,
        channels: 2,
        container: $<HTMLDivElement>("#input-analyser-ui")[0]
    });
    uiEnv.outputScope = new Scope({
        audioCtx: audioEnv.audioCtx,
        analyser: audioEnv.analyserOutput,
        splitter: audioEnv.splitterOutput,
        channels: 1,
        container: $<HTMLDivElement>("#output-analyser-ui")[0]
    });
    uiEnv.analysersInited = true;
};
/**
 * Update dsp inputs, outputs, params info
 *
 * @param {(FaustAudioWorkletNode | FaustScriptProcessorNode)} [node]
 * @returns
 */
const refreshDspUI = (node?: FaustAudioWorkletNode | FaustScriptProcessorNode) => {
    if (!node) {
        $("#dsp-ui-detail").hide();
        $("#dsp-ui-default").removeClass(["badge-success", "switch"]).addClass("badge-warning").html("no DSP yet");
        return;
    }
    $("#dsp-ui-detail").show();
    if (node instanceof ScriptProcessorNode) {
        $("#dsp-ui-default").removeClass("badge-success").addClass(["badge-warning", "switch"]).html("ScriptProcessor");
    } else {
        $("#dsp-ui-default").removeClass("badge-warning").addClass(["badge-success", "switch"]).html("AudioWorklet");
    }
    $("#dsp-ui-detail-inputs").html(node.getNumInputs().toString());
    $("#dsp-ui-detail-outputs").html(node.getNumOutputs().toString());
    $("#dsp-ui-detail-params").html(node.getParams().length.toString());
};
/**
 * Init editor, register faust language and code hint
 *
 * @returns
 */
const initEditor = async () => {
    const code = `import("stdfaust.lib");
process = ba.pulsen(1, 10000) : pm.djembe(60, 0.3, 0.4, 1) <: dm.freeverb_demo;`;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const polycode = `import("stdfaust.lib");
process = ba.pulsen(1, ba.hz2midikey(freq) * 1000) : pm.marimba(freq, 0, 7000, 0.5, 0.8) * gate * gain with {
    freq = hslider("freq", 440, 40, 8000, 1);
    gain = hslider("gain", 0.5, 0, 1, 0.01);
    gate = button("gate");
};
effect = dm.freeverb_demo;`;
    const monaco = await import("monaco-editor"); // eslint-disable-line import/no-unresolved
    monaco.languages.register(faustlang.language);
    monaco.languages.setLanguageConfiguration("faust", faustlang.config);
    monaco.editor.defineTheme("vs-dark", faustlang.theme);
    let saveCode = false;
    try {
        saveCode = JSON.parse(localStorage.getItem("faust_editor_params")).saveCode;
    } catch {} // eslint-disable-line no-empty
    const editor = monaco.editor.create($("#editor")[0], {
        value: saveCode ? (localStorage.getItem("faust_editor_code") || code) : code,
        language: "faust",
        theme: "vs-dark",
        dragAndDrop: true,
        mouseWheelZoom: true,
        wordWrap: "on"
    });
    faustlang.getProviders().then((providers) => {
        monaco.languages.registerHoverProvider("faust", providers.hoverProvider);
        monaco.languages.setMonarchTokensProvider("faust", providers.tokensProvider);
        monaco.languages.registerCompletionItemProvider("faust", providers.completionItemProvider);
        const faustDocURL = "https://faust.grame.fr/doc/libraries/";
        const showDoc = () => {
            const matched = faustlang.matchDocKey(providers.docs, editor.getModel(), editor.getPosition());
            if (matched) {
                const prefix = matched.nameArray.slice();
                prefix.pop();
                const doc = matched.doc;
                $("#a-docs").attr("href", `${faustDocURL}#${prefix.length ? prefix.join(".") + "." : ""}${doc.name.replace(/[[\]|]/g, "").toLowerCase()}`)[0].click();
                return;
            }
            $("#a-docs").attr("href", faustDocURL)[0].click();
        };
        $("#btn-docs").off("click").on("click", showDoc);
    });
    $(window).on("resize", () => editor.layout());
    return editor;
};
