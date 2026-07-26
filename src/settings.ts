/*
 *  Power BI Visualizations
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */

"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/*
 * Window Settings
 */

class WindowSettingsCard extends FormattingSettingsCard {

    useWindowTypeDays = new formattingSettings.ToggleSwitch({
        name: "useWindowTypeDays",
        displayName: "Use Calendar Days",
        value: true
    });

    shortWindow = new formattingSettings.NumUpDown({
        name: "shortWindow",
        displayName: "Short Window",
        value: 7
    });

    baselineWindow = new formattingSettings.NumUpDown({
        name: "baselineWindow",
        displayName: "Baseline Window",
        value: 30
    });

    longWindow = new formattingSettings.NumUpDown({
        name: "longWindow",
        displayName: "Long Window",
        value: 60
    });

    name = "windowSettings";

    displayName = "Window Settings";

    slices: Array<FormattingSettingsSlice> = [
        this.useWindowTypeDays,
        this.shortWindow,
        this.baselineWindow,
        this.longWindow
    ];
}

/*
 * Behaviour Settings
 */

class BehaviourSettingsCard extends FormattingSettingsCard {

    higherIsBetter = new formattingSettings.ToggleSwitch({
        name: "higherIsBetter",
        displayName: "Higher Is Better",
        value: true
    });

    useTarget = new formattingSettings.ToggleSwitch({
        name: "useTarget",
        displayName: "Use Target",
        value: false
    });

    targetValue = new formattingSettings.NumUpDown({
        name: "targetValue",
        displayName: "Target Value",
        value: 0
    });

    name = "behaviourSettings";

    displayName = "Behaviour";

    slices: Array<FormattingSettingsSlice> = [
        this.higherIsBetter,
        this.useTarget,
        this.targetValue
    ];
}

/*
 * Colour Settings
 */

class ColourSettingsCard extends FormattingSettingsCard {

    stateColour = new formattingSettings.ColorPicker({
        name: "stateColour",
        displayName: "State",
        value: { value: "#118DFF" }
    });

    baselineColour = new formattingSettings.ColorPicker({
        name: "baselineColour",
        displayName: "Baseline",
        value: { value: "#777777" }
    });

    sigma1Colour = new formattingSettings.ColorPicker({
        name: "sigma1Colour",
        displayName: "±1σ",
        value: { value: "#D6B85A" }
    });

    sigma2Colour = new formattingSettings.ColorPicker({
        name: "sigma2Colour",
        displayName: "±2σ",
        value: { value: "#DD9999" }
    });

    name = "colours";

    displayName = "Colours";

    slices: Array<FormattingSettingsSlice> = [
        this.stateColour,
        this.baselineColour,
        this.sigma1Colour,
        this.sigma2Colour
    ];
}

/*
 * Visual Formatting Model
 */

export class VisualFormattingSettingsModel extends FormattingSettingsModel {

    windowSettings = new WindowSettingsCard();

    behaviourSettings = new BehaviourSettingsCard();

    colours = new ColourSettingsCard();

    cards = [
        this.windowSettings,
        this.behaviourSettings,
        this.colours
    ];
}