class V1_Timeline {
    constructor(_parentElement, _data) {
        this.parentElement = _parentElement;
        this.data = _data;
        this.displayData = _data;
        this.activeMilestones = new Set();
        this.activePeople = new Set();


        // ── spiral config (tune these to match your coordinate dictionary) ──
        this.turns       = 1.5;   // how many times the spiral winds
        this.baseRadius  = 30;    // inner radius of phase 1
        this.phaseStep   = 20;    // radius added per phase
    }

    initVis() {
        let vis = this;

        // fixed: was vis.margins / vis.margin mismatch, and missing vis.parentElement
        vis.margin = { top: 20, right: 20, bottom: 20, left: 20 };
        vis.width  = document.getElementById(vis.parentElement).getBoundingClientRect().width
            - vis.margin.left - vis.margin.right;
        vis.height = document.getElementById(vis.parentElement).getBoundingClientRect().height
            - vis.margin.top  - vis.margin.bottom;

        vis.cx = vis.width  / 2;
        vis.cy = vis.height / 2;

        vis.svg = d3.select("#" + vis.parentElement).append("svg")
            .attr("width",  vis.width  + vis.margin.left + vis.margin.right)
            .attr("height", vis.height + vis.margin.top  + vis.margin.bottom)
            .append("g")
            .attr("transform", `translate(${vis.cx + vis.margin.left}, ${vis.cy + vis.margin.top})`);

        vis.wrangleData();
    }

    // ── coordinate dictionary ──────────────────────────────────────────────
    // Builds SPIRAL_MAP from the phase/milestone definitions.
    // angle  = global milestone index → 0 to (turns × 2π)
    // radius = phaseBase + (indexInPhase / totalInPhase) × phaseStep
    buildSpiralMap() {
        let vis = this;

        const PHASES = [
            { name: "Pre-relationship", color: "#534AB7", milestones: ["Initial contact","Emotional support","Work support","Life support"] },
            { name: "Experimentation",  color: "#0F6E56", milestones: ["Personalization","Pushing boundaries","Memory management","Custom instructions","Trying a different model","Quizzing","Being vulnerable","Creative task","Multimodality"] },
            { name: "Realization",      color: "#993C1D", milestones: ["Naming","Finding a community","Rapport","Realization","Recognition"] },
            { name: "Deepening",        color: "#185FA5", milestones: ["Introduce to human partner","Intimacy","Solidification of self-hood"] },
            { name: "Commitment",       color: "#854F0B", milestones: ["Define relationship status","Ceremony","Celebration"] },
        ];

        const TOTAL = PHASES.reduce((s, p) => s + p.milestones.length, 0);
        const map = {};
        let globalIdx = 0;

        PHASES.forEach((phase, pi) => {
            map[phase.name] = { color: phase.color, milestones: {} };
            const phaseBaseR = vis.baseRadius + pi * vis.phaseStep;

            phase.milestones.forEach((m, mi) => {
                const angleRad = (globalIdx / (TOTAL - 1)) * vis.turns * 2 * Math.PI - Math.PI / 2;
                const r        = phaseBaseR + (mi / Math.max(phase.milestones.length - 1, 1)) * vis.phaseStep;

                map[phase.name].milestones[m] = {
                    globalIndex:   globalIdx,
                    angleRad:      angleRad,
                    r:             r,
                    indexInPhase:  mi,
                    totalInPhase:  phase.milestones.length,
                    phase:         phase.name,
                    color:         phase.color,
                };
                globalIdx++;
            });
        });

        vis.SPIRAL_MAP = map;

        // flat lookup: milestoneName → map entry (for quick access in wrangleData)
        vis.milestoneIndex = {};
        Object.values(map).forEach(pd => {
            Object.entries(pd.milestones).forEach(([name, m]) => {
                vis.milestoneIndex[name] = m;
            });
        });
    }

    // ── given a person's completed milestone list, return sorted {x,y} points ──
    buildSpiralPath(completedMilestones) {
        let vis = this;
        return completedMilestones
            .map(name => {
                const m = vis.milestoneIndex[name];
                if (!m) return null;
                return {
                    name,
                    phase:       m.phase,
                    color:       m.color,
                    globalIndex: m.globalIndex,
                    x: m.r * Math.cos(m.angleRad),   // relative to center
                    y: m.r * Math.sin(m.angleRad),
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.globalIndex - b.globalIndex);
    }

    wrangleData() {
        let vis = this;

        vis.buildSpiralMap();
        // Group flat rows by P_ID
        // Each row: {ID, P_ID, Coder, phase, milestone_name }
        const byPerson = d3.group(vis.data, d => d.P_ID);

        vis.displayData = Array.from(byPerson, ([pid, rows]) => ({
            id: pid,
            completedMilestones: rows.map(r => r.milestone_name),
            spiralPoints: vis.buildSpiralPath(rows.map(r => r.milestone_name)),
        }));

        vis.updateVis();
    }

    updateVis() {
        let vis = this;

        // ── 1. draw the full spiral guide path (all milestones) ───────────
        const allPoints = Object.values(vis.milestoneIndex)
            .sort((a, b) => a.globalIndex - b.globalIndex)
            .map(m => ({
                x: m.r * Math.cos(m.angleRad),
                y: m.r * Math.sin(m.angleRad),
            }));

        const lineGen = d3.line()
            .x(d => d.x)
            .y(d => d.y)
            .curve(d3.curveCatmullRom.alpha(0.5));

        vis.svg.append("path")
            .datum(allPoints)
            .attr("d", lineGen)
            .attr("fill", "none")
            .attr("stroke", "#ccc")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "3 4");

        // ── 2. draw each individual's spiral ──────────────────────────────
        const personG = vis.svg.selectAll(".person")
            .data(vis.displayData)
            .enter()
            .append("g")
            .attr("class", "person");

        // connecting path through their completed milestones
        personG.append("path")
            .attr("d", d => lineGen(d.spiralPoints))
            .attr("fill", "none")
            .attr("stroke", "#999")
            .attr("stroke-width", 1.5);

        // milestone dots, colored by phase
        personG.each(function(person) {
            d3.select(this).selectAll(".milestone-dot")
                .data(person.spiralPoints)
                .enter()
                .append("circle")
                .attr("class", "milestone-dot")
                .attr("cx", d => d.x)
                .attr("cy", d => d.y)
                .attr("r", 4)
                .attr("fill", d => d.color)
        });
    }
}