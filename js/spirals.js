class Timeline {
    constructor(_parentElement, _data) {
        this._parentElement = _parentElement;
        this.data = _data;
        this.displayData = [];
        this.fullData = [];
        this.activeMilestones = new Set();
        this.activePhases = new Set();
    }

    initVis() {
        let vis = this;
        vis.margin = { top: 20, right: 20, bottom: 20, left: 20 };

        vis.width  = document.getElementById(vis._parentElement).getBoundingClientRect().width  - vis.margin.left - vis.margin.right;
        vis.height = document.getElementById(vis._parentElement).getBoundingClientRect().height - vis.margin.top  - vis.margin.bottom;

        const container = d3.select("#" + vis._parentElement);

        vis.filterBar = container.append("div").attr("class", "filter-bar")
            .style("display", "flex").style("flex-wrap", "wrap")
            .style("gap", "8px").style("margin-bottom", "12px")
            .style("align-items", "center");

        vis.phaseFilterWrap     = vis.filterBar.append("div").attr("class", "filter-group")
            .style("display", "flex").style("flex-wrap", "wrap").style("gap", "6px").style("align-items", "center");
        vis.milestoneFilterWrap = vis.filterBar.append("div").attr("class", "filter-group")
            .style("display", "flex").style("align-items", "center").style("gap", "6px");

        vis.grid = container.append("div").attr("class", "spiral-grid")
            .style("display", "flex").style("flex-wrap", "wrap").style("gap", "12px");

        vis.tooltip = d3.select("body").append("div")
            .attr("class", "tl-tooltip")
            .style("position", "absolute")
            .style("background", "white")
            .style("border", "1px solid #ccc")
            .style("border-radius", "6px")
            .style("padding", "6px 10px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("visibility", "hidden")
            .style("z-index", "100");

        vis.phaseColors = {
            "Pre-relationship": "#d4b896",  // beige
            "Experimentation":  "#4caf50",  // green
            "Realization":      "#f9c74f",  // yellow
            "Deepening":        "#4a90d9",  // blue
            "Commitment":       "#e63946",  // red"
            "Model disruption": "slash"     // special marker
        };

        vis.wrangleData();
    }

    wrangleData() {
        let vis = this;
        d3.csv(vis.data).then(function(data) {
            // normalize / trim fields so phase matching is reliable (trailing-space issues)
            data.forEach(d => {
                d.ID = +d.ID;
                if (d.P_ID) d.P_ID = d.P_ID.trim();
                if (d.phase) d.phase = d.phase.trim();
                if (d.milestone_name) d.milestone_name = d.milestone_name.trim();
                if (d.quote) d.quote = d.quote.trim();
            });

            data.sort((a, b) => a.ID - b.ID);
            vis.fullData = data;

            vis.activePhases     = new Set(data.map(d => d.phase));
            vis.activeMilestones = new Set(data.map(d => d.milestone_name));

            vis.buildFilters();
            vis.applyFiltersAndUpdate();
        });
    }

    buildFilters() {
        let vis = this;

        vis.phaseFilterWrap.append("span")
            .style("font-size", "12px").style("font-weight", "600")
            .text("Phase:");

        Object.entries(vis.phaseColors).forEach(([phase, color]) => {
            const isSlash = color === "slash";
            const btnColor = isSlash ? "#c0392b" : color;
            const textColor = (phase === "Realization" || phase === "Pre-relationship") ? "#333" : "white";

            const btn = vis.phaseFilterWrap.append("button")
                .attr("class", "filter-pill")
                .attr("data-phase", phase)
                .style("border", "none").style("border-radius", "12px")
                .style("padding", "3px 10px").style("font-size", "11px")
                .style("cursor", "pointer").style("opacity", "1")
                .style("color", textColor);

            if (isSlash) {
                // Strikethrough style button for model disruption
                btn.style("background", "#fff")
                    .style("border", "2px solid #c0392b")
                    .style("color", "#c0392b")
                    .style("text-decoration", "line-through");
            } else {
                btn.style("background", btnColor);
            }

            btn.text(phase)
                .on("click", function() {
                    const p = d3.select(this).attr("data-phase");
                    if (vis.activePhases.has(p)) {
                        vis.activePhases.delete(p);
                        d3.select(this).style("opacity", "0.3");
                    } else {
                        vis.activePhases.add(p);
                        d3.select(this).style("opacity", "1");
                    }
                    vis.applyFiltersAndUpdate();
                });
        });

        // Milestone dropdown
        vis.milestoneFilterWrap.append("span")
            .style("font-size", "12px").style("font-weight", "600")
            .style("margin-left", "12px")
            .text("Milestone:");

        const allMilestones = [...new Set(vis.fullData.map(d => d.milestone_name))].sort();

        const select = vis.milestoneFilterWrap.append("select")
            .style("font-size", "12px").style("padding", "3px 6px")
            .style("border-radius", "6px").style("border", "1px solid #ccc");

        select.append("option").attr("value", "all").text("All milestones");
        allMilestones.forEach(m => {
            select.append("option").attr("value", m).text(m);
        });

        select.on("change", function() {
            const val = this.value;
            vis.activeMilestones = val === "all"
                ? new Set(vis.fullData.map(d => d.milestone_name))
                : new Set([val]);
            vis.applyFiltersAndUpdate();
        });
    }

    applyFiltersAndUpdate() {
        let vis = this;

        const filtered = vis.fullData.filter(d =>
            vis.activePhases.has(d.phase) &&
            vis.activeMilestones.has(d.milestone_name)
        );

        const filteredSet = new Set(filtered.map(d => d.ID));

        const byPerson = d3.group(vis.fullData, d => d.P_ID);
        vis.displayData = Array.from(byPerson, ([person, entries]) => ({
            person,
            entries,
            filteredSet
        }));

        vis.updateVis();
    }

    updateVis() {
        let vis = this;
        if (!vis.displayData || vis.displayData.length === 0) return;

        const turns = 3;
        const maxR  = 56;
        const W = 140, H = 140;
        const cx = W / 2, cy = H / 2;
        const dotR = 5;

        function spiralPos(i, n) {
            const tInv  = n <= 1 ? 1 : 1 - i / (n - 1);
            const angle = tInv * turns * 2 * Math.PI - Math.PI / 2;
            const r     = tInv * maxR;
            return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
        }

        const cards = vis.grid
            .selectAll(".spiral-card")
            .data(vis.displayData, d => d.person);

        cards.exit().remove();

        const cardsEnter = cards.enter().append("div").attr("class", "spiral-card");
        cardsEnter.append("p").attr("class", "person-label");
        cardsEnter.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", "100%");

        const cardsMerged = cardsEnter.merge(cards);
        cardsMerged.select(".person-label").text(d => d.person);

        cardsMerged.each(function(d) {
            const svg = d3.select(this).select("svg");
            const n   = d.entries.length;

            // Guide path
            const guidePts = d3.range(200).map((_, i) => {
                const tInv  = 1 - i / 199;
                const angle = tInv * turns * 2 * Math.PI - Math.PI / 2;
                return [cx + tInv * maxR * Math.cos(angle),
                    cy + tInv * maxR * Math.sin(angle)];
            });
            const lineGen = d3.line().x(p => p[0]).y(p => p[1]).curve(d3.curveCatmullRom);

            let guide = svg.selectAll(".spiral-guide").data([null]);
            guide.enter().append("path").attr("class", "spiral-guide")
                .merge(guide)
                .attr("d", lineGen(guidePts))
                .attr("fill", "none").attr("stroke", "#ddd").attr("stroke-width", 0.8);

            // One <g> per entry
            const entryGroups = svg.selectAll(".entry-group")
                .data(d.entries, e => e.ID);

            entryGroups.exit().remove();

            const entryGroupsEnter = entryGroups.enter()
                .append("g").attr("class", "entry-group");

            const merged = entryGroupsEnter.merge(entryGroups);

            merged.each(function(e, i) {
                const g = d3.select(this);
                const { x, y } = spiralPos(i, n);
                const isDisruption = e.phase === "Model disruption";
                const isFiltered = !d.filteredSet.has(e.ID);

                if (isDisruption) {
                    // Remove any stale circle
                    g.selectAll("circle").remove();

                    let slash = g.selectAll("line.slash-mark").data([e]);
                    slash.enter().append("line").attr("class", "slash-mark")
                        .merge(slash)
                        .attr("x1", x - 6).attr("y1", y + 6)
                        .attr("x2", x + 6).attr("y2", y - 6)
                        .attr("stroke", "#c0392b")
                        .attr("stroke-width", 2.5)
                        .attr("stroke-linecap", "round")
                        .style("opacity", isFiltered ? 0.2 : 1);

                } else {
                    // Remove any stale slash
                    g.selectAll("line.slash-mark").remove();

                    let dot = g.selectAll("circle.dot-mark").data([e]);
                    dot.enter().append("circle").attr("class", "dot-mark")
                        .attr("r", 0)
                        .merge(dot)
                        .attr("cx", x).attr("cy", y)
                        .attr("fill", isFiltered ? "#ccc" : (vis.phaseColors[e.phase] || "#d4b896"))
                        .transition().duration(500).ease(d3.easeBackOut)
                        .delay(i * 40)
                        .attr("r", dotR)
                        .style("opacity", isFiltered ? 0.2 : 1);
                }

                // Tooltip on the group
                // File: `js/spirals.js` — corrected tooltip content in updateVis()
                    g.on("mouseover", function(event) {
                        vis.tooltip.style("visibility", "visible")
                            .html(`<strong>${e.milestone_name}</strong><br>Phase: ${e.phase}<br><em>${e.quote || ''}</em>`);
                    })
                    .on("mousemove", function(event) {
                        vis.tooltip
                            .style("left", (event.pageX + 12) + "px")
                            .style("top",  (event.pageY - 28) + "px");
                    })
                    .on("mouseout", () => vis.tooltip.style("visibility", "hidden"));
            });
        });
    }
}