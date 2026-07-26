"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbi.DataView;

import IVisualEventService = powerbi.extensibility.IVisualEventService;
import { VisualFormattingSettingsModel } from "./settings";

import IVisualHost = powerbi.extensibility.visual.IVisualHost;

interface Point {
    time: Date;
    value: number;
}

interface SeriesPoint {
    time: Date;
    value: number;
}

interface StateVector {
    state: number;  /* The most recent value in the time series */
    shortBaseline: number; /* The average of the most recent shortWindow observations/days */
    baseline: number; /* The average of the most recent baselineWindow observations/days */
    reference: number; /* The reference value, either the baseline or a target value */
    directionalMomentum: number; /* Short-term trend relative to long-term trend: (shortBaseline - baseline) / baseline */
    variability: number; /* The standard deviation of the most recent baselineWindow observations/days */
    directionalError: number; /* Normalised deviation from the reference: (state - reference) / variability */
    classification: string; /* Qualitative state classification derived from directionalError thresholds */
}

interface RenderSeries {
    stateSeries: SeriesPoint[];
    baselineSeries: SeriesPoint[];
    upperOneSigmaSeries: SeriesPoint[];
    lowerOneSigmaSeries: SeriesPoint[];
    upperTwoSigmaSeries: SeriesPoint[];
    lowerTwoSigmaSeries: SeriesPoint[];
}

interface ThemeColours {
    state: string;
    baseline: string;
    sigma1: string;
    sigma2: string;

    foreground: string;
    background: string;
    axis: string;
    grid: string;

    largePositive: string;
    positive: string;
    neutral: string;
    negative: string;
    largeNegative: string;
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private events: IVisualEventService;

    private readonly shortWindow: number = 7; /* The number of observations/days used to calculate the short-term baseline */
    private readonly baselineWindow: number = 30; /* The number of observations/days used to calculate the baseline and variability */
    private readonly longWindow: number = 60; /* Not currently used, but could be used for a longer-term baseline or trend analysis */

    private readonly useTarget: boolean = false; /* If true, the targetValue will be used as the reference instead of the baseline */
    private readonly targetValue: number | undefined = undefined; /* If useTarget is true, this value will be used as the reference instead of the baseline */

    private readonly higherIsBetter: boolean = true; /* True: higher values are better. False: lower values are better. */
    private readonly useWindowTypeDays: boolean = true; /* If true, the window sizes are interpreted as days. If false, they are interpreted as number of observations. */

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private host: IVisualHost;
    private theme: ThemeColours;

    private loadThemeColours(): ThemeColours {

    const palette = this.host.colorPalette;

    return {

        //
        // Theme colours
        //

        state: palette.getColor("State").value,
        baseline: palette.getColor("Baseline").value,
        sigma1: palette.getColor("Sigma1").value,
        sigma2: palette.getColor("Sigma2").value,

        foreground: palette.foreground?.value ?? "#222222",
        background: palette.background?.value ?? "#FFFFFF",

        axis: palette.foreground?.value ?? "#666666",
        grid: palette.foreground?.value ?? "#CCCCCC",

        //
        // Semantic colours
        //

        largePositive: "#00A2E8",
        positive: "#70AD47",
        neutral: "#808080",
        negative: "#E46C0A",
        largeNegative: "#B00020"
    };
}

    constructor(options: VisualConstructorOptions) {
        this.formattingSettingsService = new FormattingSettingsService();
        this.host = options.host;
        this.theme = this.loadThemeColours();
        this.target = options.element;
    }

    public update(options: VisualUpdateOptions): void {
        this.clear();

        const dataView: DataView | undefined = options.dataViews?.[0];

        this.theme = this.loadThemeColours();

        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, options.dataViews[0]);

        if (!dataView?.categorical) {
            this.renderMessage("Add Timestamp and Value fields.");
            return;
        }

        const category = dataView.categorical.categories?.[0];
        const valueColumn = dataView.categorical.values?.[0];

        if (!category || !valueColumn) {
            this.renderMessage("Waiting for Timestamp and Value.");
            return;
        }

        const points = this.extractPoints(dataView);

        if (points.length === 0) {
            this.renderMessage("No valid time-series data.");
            return;
        }

        points.sort((a, b) => a.time.getTime() - b.time.getTime());

        const stateVector = this.calculateStateVector(points);
        const renderSeries = this.calculateRenderSeries(points);

        this.render(
            stateVector,
            renderSeries,
            options.viewport.width,
            options.viewport.height
        );
    }

    private extractPoints(dataView: DataView): Point[] {
        const points: Point[] = [];

        const category = dataView.categorical?.categories?.[0];
        const valueColumn = dataView.categorical?.values?.[0];

        if (!category || !valueColumn) {
            return points;
        }

        for (let i = 0; i < category.values.length; i++) {
            const rawTime = category.values[i];
            const rawValue = valueColumn.values[i];

            if (rawTime === null || rawTime === undefined) {
                continue;
            }

            if (rawValue === null || rawValue === undefined) {
                continue;
            }

            const time = this.parseDate(rawTime);
            const value = Number(rawValue);

            if (!isNaN(time.getTime()) && Number.isFinite(value)) {
                points.push({
                    time,
                    value
                });
            }
        }

        return points;
    }

    private parseDate(rawTime: unknown): Date {
        if (rawTime instanceof Date) {
            return rawTime;
        }

        if (typeof rawTime === "number") {
            return new Date(rawTime);
        }

        return new Date(String(rawTime));
    }

    private calculateStateVector(points: Point[]): StateVector {
        const lastIndex = points.length - 1;

        const state = points[lastIndex].value;

        const shortBaseline = this.trailingAverage(
            points,
            lastIndex,
            this.shortWindow
        );

        const baseline = this.trailingAverage(
            points,
            lastIndex,
            this.baselineWindow
        );

        const variability = this.trailingStandardDeviation(
            points,
            lastIndex,
            this.baselineWindow
        );

        const reference = this.calculateReference(baseline);

        const rawMomentum =
            this.safeDivide(
                shortBaseline - baseline,
                baseline
            );

        const directionalSign = this.higherIsBetter ? 1 : -1;

        const directionalMomentum = rawMomentum * directionalSign;

        const rawError = this.safeDivide(
            state - reference,
            variability
        );

        const directionalError = rawError * directionalSign;

        const classification = this.classify(
            directionalError/*,
            directionalMomentum */
        );

        return {
            state,
            shortBaseline,
            baseline,
            reference,
            directionalMomentum,
            variability,
            directionalError,
            classification
        };
    }

    private calculateReference(baseline: number): number {
        if (this.useTarget && this.targetValue !== undefined) {
            return this.targetValue;
        }

        return baseline;
    }

    private calculateRenderSeries(points: Point[]): RenderSeries {
        const stateSeries: SeriesPoint[] = [];
        const baselineSeries: SeriesPoint[] = [];
        const upperOneSigmaSeries: SeriesPoint[] = [];
        const lowerOneSigmaSeries: SeriesPoint[] = [];
        const upperTwoSigmaSeries: SeriesPoint[] = [];
        const lowerTwoSigmaSeries: SeriesPoint[] = [];

        for (let i = 0; i < points.length; i++) {
            const baseline = this.trailingAverage(
                points,
                i,
                this.baselineWindow
            );

            const variability = this.trailingStandardDeviation(
                points,
                i,
                this.baselineWindow
            );

            const reference = this.calculateReference(baseline);

            stateSeries.push({
                time: points[i].time,
                value: points[i].value
            });

            baselineSeries.push({
                time: points[i].time,
                value: reference
            });

            upperOneSigmaSeries.push({
                time: points[i].time,
                value: reference + variability
            });

            lowerOneSigmaSeries.push({
                time: points[i].time,
                value: reference - variability
            });

            upperTwoSigmaSeries.push({
                time: points[i].time,
                value: reference + (2 * variability)
            });

            lowerTwoSigmaSeries.push({
                time: points[i].time,
                value: reference - (2 * variability)
            });
        }

        return {
            stateSeries,
            baselineSeries,
            upperOneSigmaSeries,
            lowerOneSigmaSeries,
            upperTwoSigmaSeries,
            lowerTwoSigmaSeries
        };
    }

    private trailingAverage(
    points: Point[],
    index: number,
    windowSize: number
    ): number {

        const slice = this.trailingWindowPoints(
            points,
            index,
            windowSize
        );

        if (slice.length === 0) {
            return 0;
        }

        const total = slice.reduce(
            (sum, point) => sum + point.value,
            0
        );

        return total / slice.length;
    }

    private trailingStandardDeviation(
    points: Point[],
    index: number,
    windowSize: number
    ): number {

        const slice = this.trailingWindowPoints(
            points,
            index,
            windowSize
        );

        if (slice.length < 2) {
            return 0;
        }

        const mean =
            slice.reduce(
                (sum, point) => sum + point.value,
                0
            ) / slice.length;

        const variance =
            slice.reduce(
                (sum, point) =>
                    sum + Math.pow(point.value - mean, 2),
                0
            ) / slice.length;     // STDEV.P compatible

        return Math.sqrt(variance);
    }

    private trailingWindowPoints(
    points: Point[],
    index: number,
    windowSize: number
    ): Point[] {

        //
        // Observation mode
        // Uses last N observations
        //
        if (!this.useWindowTypeDays) {

            const startIndex =
                Math.max(0, index - windowSize + 1);

            return points.slice(
                startIndex,
                index + 1
            );
        }

        //
        // Calendar-day mode
        // DAX DATESINPERIOD compatible
        //
        const currentTime =
            points[index].time.getTime();

        const millisecondsPerDay =
            24 * 60 * 60 * 1000;

        const startTime =
            currentTime -
            (windowSize * millisecondsPerDay);

        return points.filter(
            (point, pointIndex) => {

                const pointTime =
                    point.time.getTime();

                return (
                    pointIndex <= index &&
                    pointTime > startTime &&   // intentional
                    pointTime <= currentTime
                );
            }
        );
    }

    private safeDivide(
        numerator: number,
        denominator: number
    ): number {
        if (!Number.isFinite(denominator)) {
            return 0;
        }

        if (Math.abs(denominator) < 0.000001) {
            return 0;
        }

        return numerator / denominator;
    }

    private classify(
        directionalError: number
    ): string {
        if (directionalError <= -2) {
            return "LARGE NEGATIVE";
        }

        if (directionalError <= -1) {
            return "NEGATIVE";
        }

        if (directionalError >= 2) {
            return "LARGE POSITIVE";
        }

        if (directionalError >= 1) {
            return "POSITIVE";
        }

        return "NEUTRAL";
    }

    private render(
        stateVector: StateVector,
        renderSeries: RenderSeries,
        width: number,
        height: number
    ): void {
        const root = document.createElement("div");

        root.style.width = "100%";
        root.style.height = "100%";
        root.style.boxSizing = "border-box";
        root.style.padding = "8px";
        root.style.fontFamily = "Segoe UI, sans-serif";
        root.style.color = this.theme.foreground;

        const title = document.createElement("div");

        title.textContent = "State Vector Visual 0.97.5";
        title.style.fontSize = "13px";
        title.style.fontWeight = "600";
        title.style.marginBottom = "6px";

        root.appendChild(title);

        const cards = this.createCards(stateVector);

        root.appendChild(cards);

        const chart = this.createChart(
            renderSeries,
            Math.max(120, width - 16),
            Math.max(120, height - 88)
        );

        root.appendChild(chart);

        this.target.appendChild(root);
    }

    private createCards(stateVector: StateVector): HTMLElement {
        const cards = document.createElement("div");

        cards.style.display = "flex";
        cards.style.flexWrap = "wrap";
        cards.style.gap = "14px";
        cards.style.marginBottom = "8px";
        cards.style.alignItems = "baseline";

        this.appendMetric(cards, "State", stateVector.state, "");
        this.appendMetric(cards, "Baseline", stateVector.baseline, "");
        this.appendMetric(cards, "Momentum_bp", stateVector.directionalMomentum*10000, ""); /* Scale to basis points for better interpretability */
        this.appendMetric(cards, "Variability", stateVector.variability, "");
        this.appendMetric(cards, "Error", stateVector.directionalError, "");

        const classification = document.createElement("div");

        classification.textContent = stateVector.classification;
        classification.style.fontSize = "13px";
        classification.style.fontWeight = "700";
        classification.style.padding = "4px 8px";
        classification.style.borderRadius = "4px";
        classification.style.backgroundColor = this.classificationColour(
            stateVector.classification
        );
        classification.style.color = this.theme.foreground;

        cards.appendChild(classification);

        return cards;
    }

    private appendMetric(
        parent: HTMLElement,
        label: string,
        value: number,
        suffix: string
    ): void {
        const wrapper = document.createElement("div");

        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.minWidth = "78px";

        const labelElement = document.createElement("span");

        labelElement.textContent = label;
        labelElement.style.fontSize = "10px";
        labelElement.style.color = this.theme.foreground;

        const valueElement = document.createElement("span");

        valueElement.textContent = value.toFixed(2) + suffix;
        valueElement.style.fontSize = "16px";
        valueElement.style.fontWeight = "700";

        wrapper.appendChild(labelElement);
        wrapper.appendChild(valueElement);

        parent.appendChild(wrapper);
    }

    private createChart(
        renderSeries: RenderSeries,
        width: number,
        height: number
    ): SVGSVGElement {
        const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
        );

        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);

        const paddingLeft = 40;
        const paddingRight = 12;
        const paddingTop = 16;
        const paddingBottom = 24;

        const plotWidth = width - paddingLeft - paddingRight;
        const plotHeight = height - paddingTop - paddingBottom;

        const allSeriesValues = renderSeries.stateSeries
            .map((point) => point.value)
            .concat(renderSeries.baselineSeries.map((point) => point.value))
            .concat(renderSeries.upperTwoSigmaSeries.map((point) => point.value))
            .concat(renderSeries.lowerTwoSigmaSeries.map((point) => point.value));

        const minValue = Math.min(...allSeriesValues);
        const maxValue = Math.max(...allSeriesValues);

        const minTime = renderSeries.stateSeries[0].time.getTime();
        const maxTime = renderSeries.stateSeries[
            renderSeries.stateSeries.length - 1
        ].time.getTime();

        const valueRange = maxValue - minValue || 1;
        const timeRange = maxTime - minTime || 1;

        const xScale = (time: Date): number => {
            return paddingLeft +
                ((time.getTime() - minTime) / timeRange) * plotWidth;
        };

        const yScale = (value: number): number => {
            return paddingTop +
                (1 - ((value - minValue) / valueRange)) * plotHeight;
        };

        this.drawAxes(
            svg,
            width,
            height,
            paddingLeft,
            paddingRight,
            paddingTop,
            paddingBottom
        );

        this.drawLine(
            svg,
            renderSeries.upperTwoSigmaSeries,
            xScale,
            yScale,
            this.theme.sigma2,
            1,
            "3 3"
        );

        this.drawLine(
            svg,
            renderSeries.lowerTwoSigmaSeries,
            xScale,
            yScale,
            this.theme.sigma2,
            1,
            "3 3"
        );

        this.drawLine(
            svg,
            renderSeries.upperOneSigmaSeries,
            xScale,
            yScale,
            this.theme.sigma1,
            1,
            "3 3"
        );

        this.drawLine(
            svg,
            renderSeries.lowerOneSigmaSeries,
            xScale,
            yScale,
            this.theme.sigma1,
            1,
            "3 3"
        );

        this.drawLine(
            svg,
            renderSeries.baselineSeries,
            xScale,
            yScale,
            this.theme.baseline,
            2,
            "4 3"
        );

        this.drawLine(
            svg,
            renderSeries.stateSeries,
            xScale,
            yScale,
            this.theme.state,
            2,
            ""
        );

        this.drawLatestMarker(
            svg,
            renderSeries.stateSeries,
            xScale,
            yScale
        );

        this.drawValueLabels(
            svg,
            minValue,
            maxValue,
            height,
            paddingTop,
            paddingBottom
        );

        this.drawLegend(svg, width);

        return svg;
    }

    private drawAxes(
        svg: SVGSVGElement,
        width: number,
        height: number,
        paddingLeft: number,
        paddingRight: number,
        paddingTop: number,
        paddingBottom: number
    ): void {
        const xAxis = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line"
        );

        xAxis.setAttribute("x1", String(paddingLeft));
        xAxis.setAttribute("y1", String(height - paddingBottom));
        xAxis.setAttribute("x2", String(width - paddingRight));
        xAxis.setAttribute("y2", String(height - paddingBottom));
        xAxis.setAttribute("stroke", this.theme.grid);
        xAxis.setAttribute("stroke-width", "1");

        svg.appendChild(xAxis);

        const yAxis = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line"
        );

        yAxis.setAttribute("x1", String(paddingLeft));
        yAxis.setAttribute("y1", String(paddingTop));
        yAxis.setAttribute("x2", String(paddingLeft));
        yAxis.setAttribute("y2", String(height - paddingBottom));
        yAxis.setAttribute("stroke", this.theme.grid);
        yAxis.setAttribute("stroke-width", "1");

        svg.appendChild(yAxis);
    }

    private drawLine(
        svg: SVGSVGElement,
        series: SeriesPoint[],
        xScale: (time: Date) => number,
        yScale: (value: number) => number,
        colour: string,
        strokeWidth: number,
        dashArray: string
    ): void {
        let pathData = "";

        series.forEach((point, index) => {
            const x = xScale(point.time);
            const y = yScale(point.value);

            if (index === 0) {
                pathData += "M " + x + " " + y;
            } else {
                pathData += " L " + x + " " + y;
            }
        });

        const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
        );

        path.setAttribute("d", pathData);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", colour);
        path.setAttribute("stroke-width", String(strokeWidth));

        if (dashArray.length > 0) {
            path.setAttribute("stroke-dasharray", dashArray);
        }

        svg.appendChild(path);
    }

    private drawLatestMarker(
        svg: SVGSVGElement,
        series: SeriesPoint[],
        xScale: (time: Date) => number,
        yScale: (value: number) => number
    ): void {
        const latest = series[series.length - 1];

        const circle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle"
        );

        circle.setAttribute("cx", String(xScale(latest.time)));
        circle.setAttribute("cy", String(yScale(latest.value)));
        circle.setAttribute("r", "4");
        circle.setAttribute("fill", this.theme.state);

        svg.appendChild(circle);
    }

    private drawValueLabels(
        svg: SVGSVGElement,
        minValue: number,
        maxValue: number,
        height: number,
        paddingTop: number,
        paddingBottom: number
    ): void {
        const maxLabel = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text"
        );

        maxLabel.textContent = maxValue.toFixed(1);
        maxLabel.setAttribute("x", "2");
        maxLabel.setAttribute("y", String(paddingTop + 4));
        maxLabel.setAttribute("font-size", "10");
        maxLabel.setAttribute("fill", this.theme.axis);

        svg.appendChild(maxLabel);

        const minLabel = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text"
        );

        minLabel.textContent = minValue.toFixed(1);
        minLabel.setAttribute("x", "2");
        minLabel.setAttribute("y", String(height - paddingBottom));
        minLabel.setAttribute("font-size", "10");
        minLabel.setAttribute("fill", this.theme.axis);

        svg.appendChild(minLabel);
    }

    private drawLegend(
        svg: SVGSVGElement,
        width: number
    ): void {
        this.drawLegendItem(svg, width - 220, 12, this.theme.state, "State");
        this.drawLegendItem(svg, width - 165, 12, this.theme.baseline, "Baseline");
        this.drawLegendItem(svg, width - 92, 12, this.theme.sigma1, "±1σ");
        this.drawLegendItem(svg, width - 52, 12, this.theme.sigma2, "±2σ");
    }

    private drawLegendItem(
        svg: SVGSVGElement,
        x: number,
        y: number,
        colour: string,
        label: string
    ): void {
        const text = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text"
        );

        text.textContent = label;
        text.setAttribute("x", String(x));
        text.setAttribute("y", String(y));
        text.setAttribute("font-size", "10");
        text.setAttribute("fill", colour);

        svg.appendChild(text);
    }

    private classificationColour(classification: string): string {
        switch (classification) {
            case "LARGE NEGATIVE":
                return "#B00020";

            case "NEGATIVE":
                return "#E46C0A";

            case "NEUTRAL":
                return "#808080";

            case "POSITIVE":
                return "#70AD47";

            case "LARGE POSITIVE":
                return "#00A2E8";

            default:
                return "#808080";
        }
    }

    private renderMessage(message: string): void {
        const container = document.createElement("div");

        container.textContent = message;
        container.style.fontFamily = "Segoe UI, sans-serif";
        container.style.fontSize = "14px";
        container.style.padding = "12px";
        container.style.color = this.theme.foreground;

        this.target.appendChild(container);
    }

    private clear(): void {
        while (this.target.firstChild) {
            this.target.removeChild(this.target.firstChild);
        }
    }

        /**
     * Returns properties pane formatting model content hierarchies, properties and latest formatting values, Then populate properties pane.
     * This method is called once every time we open properties pane or when the user edit any format property.
     */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}