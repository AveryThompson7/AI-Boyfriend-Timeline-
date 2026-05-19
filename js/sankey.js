class Sankey {
    constructor(dataPath, parentSelector = "#sankey", opts = {}) {
        this.dataPath = dataPath;
        this.parentSelector = parentSelector;
        this.options = Object.assign({
            width: 900,
            height: 360,
            margin: { top: 10, right: 10, bottom: 10, left: 10 },
            phases: ["Pre-relationship", "Experimentation", "Realization", "Deepening", "Commitment", "Model disruption"]
        }, opts);

        // colors chosen to match spirals.js
        this.phaseColors = {
            "Pre-relationship": "#d4b896",  // beige
            "Experimentation":  "#4caf50",  // green
            "Realization":      "#f9c74f",  // yellow
            "Deepening":        "#4a90d9",  // blue
            "Commitment":       "#e63946",  // red"
            "Model disruption": "#610019" // dark brown
        };
    }

    initVis() {
        let vis = this;
        vis.width = vis.options.width - vis.options.margin.left - vis.options.margin.right;
        vis.height = vis.options.height - vis.options.margin.top - vis.options.margin.bottom;


        vis.container = d3.select(vis.parentSelector);

        // SVG
        vis.svg = vis.container.append("svg")
            .attr("width", vis.width + vis.options.margin.left + vis.options.margin.right)
            .attr("height", vis.height + vis.options.margin.top + vis.options.margin.bottom)
            .append("g")
            .attr("transform", `translate(${vis.options.margin.left},${vis.options.margin.top})`);

        // tooltip (reuse class name used in spirals.js)
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
            .style("z-index", 100);

        vis.wrangleData();
    }

    wrangleData() {
        let vis = this;
        d3.csv(vis.dataPath).then(data => {
            // ensure numeric ID for sorting
            data.forEach(d => d._ID = +d.ID);

            // group by P_ID and sort by ID (timeline order)
            const byPerson = d3.group(data, d => d.P_ID);

            const phases = vis.options.phases;

            // Dynamic containers for dynamic sequence nodes and links
            const nodeMap = new Map();     // "Step X: PhaseName" -> Node metadata object
            const linkCounts = new Map();  // "SourceNode||TargetNode" -> Link metadata object

            byPerson.forEach((entries, pid) => {
                //  sort participant's events using the P_ID
                entries.sort((a, b) => a._ID - b._ID);

                // Filter out entries that have an unexpected phase
                const validEntries = entries.filter(e => phases.includes(e.phase));

                // Process nodes based on sequential position in their personal experience timeline
                validEntries.forEach((e, index) => {
                    const stepNum = index + 1;
                    const sequenceNodeName = `Step ${stepNum}: ${e.phase}`;

                    if (!nodeMap.has(sequenceNodeName)) {
                        nodeMap.set(sequenceNodeName, {
                            name: sequenceNodeName,
                            phase: e.phase,
                            step: stepNum,
                            count: 0,
                            milestones: new Set(),
                            sampleQuotes: []
                        });
                    }

                    const node = nodeMap.get(sequenceNodeName);
                    node.count += 1;
                    if (e.milestone_name) node.milestones.add(e.milestone_name);
                    if (e.quote && node.sampleQuotes.length < 5) {
                        node.sampleQuotes.push(e.quote);
                    }
                });

                // Transitions between sequential phases for this person
                for (let i = 0; i < validEntries.length - 1; i++) {
                    const fromStep = i + 1;
                    const toStep = i + 2;

                    const fromNodeName = `Step ${fromStep}: ${validEntries[i].phase}`;
                    const toNodeName = `Step ${toStep}: ${validEntries[i + 1].phase}`;

                    // Edge case safety check: prevent unintended direct self-loops
                    if (fromNodeName === toNodeName) continue;

                    const key = `${fromNodeName}||${toNodeName}`;
                    if (!linkCounts.has(key)) {
                        linkCounts.set(key, { value: 0, sampleQuotes: [] });
                    }

                    const rec = linkCounts.get(key);
                    rec.value += 1;
                    if (validEntries[i + 1].quote && rec.sampleQuotes.length < 3) {
                        rec.sampleQuotes.push(validEntries[i + 1].quote);
                    }
                }
            });

            // Convert the nodes map into an array and sort it primarily by timeline step
            const sortedNodeNames = Array.from(nodeMap.keys()).sort((a, b) => {
                const nodeA = nodeMap.get(a);
                const nodeB = nodeMap.get(b);
                if (nodeA.step !== nodeB.step) return nodeA.step - nodeB.step;
                return phases.indexOf(nodeA.phase) - phases.indexOf(nodeB.phase);
            });

            // Map variables into final structured array layout expected by d3-sankey
            vis.nodes = sortedNodeNames.map((name, index) => {
                const meta = nodeMap.get(name);
                return {
                    id: index,
                    name: meta.name, // Display friendly sequence text e.g., "Step 1: Deepening"
                    phase: meta.phase,
                    value: meta.count,
                    milestones: Array.from(meta.milestones).sort(),
                    sampleQuotes: meta.sampleQuotes
                };
            });

            // Build links array referencing new array mapping configurations
            vis.links = [];
            linkCounts.forEach((v, key) => {
                const [fromNodeName, toNodeName] = key.split("||");
                const source = sortedNodeNames.indexOf(fromNodeName);
                const target = sortedNodeNames.indexOf(toNodeName);

                if (source === -1 || target === -1) return;

                vis.links.push({
                    source,
                    target,
                    value: v.value,
                    sampleQuotes: v.sampleQuotes
                });
            });

            // remove loading status on success
            vis.container.selectAll('.sankey-status').remove();
            vis.updateVis();
        }).catch(err => {
            console.error("Failed to load sankey data:", err);
            vis.container.selectAll('.sankey-status').text('Failed to load sankey data: ' + (err && err.message ? err.message : err));
        });
    }

    updateVis() {
        let vis = this;
        vis.svg.selectAll("*").remove();

        // Sankey
        const sankeyGen = d3.sankey()
            .nodeWidth(18)
            .nodePadding(12)
            .extent([[0, 0], [vis.width, vis.height]]);

        // convert nodes and links to expected structure
        const graph = {
            nodes: vis.nodes.map(d => Object.assign({}, d)),
            links: vis.links.map(d => Object.assign({}, d))
        };

        sankeyGen(graph);

        // Color scale for phases
        const colorFor = p => vis.phaseColors[p] || "#999";

        // links
        vis.svg.append("g")
            .attr("class", "links")
            .selectAll("path")
            .data(graph.links)
            .enter().append("path")
            .attr("d", d3.sankeyLinkHorizontal())
            .attr("fill", "none")
            .attr("stroke", "#888")
            .attr("stroke-width", d => Math.max(1, d.width))
            .style("opacity", 0.6)
            .on("mouseover", function(event, d) {
                vis.tooltip.style("visibility", "visible")
                    .html(`<strong>Transition</strong><br>${d.source.name} → ${d.target.name}<br>Count: ${d.value}
                        ${d.sampleQuotes && d.sampleQuotes.length ? `<br><em>Sample quote:</em> "${d.sampleQuotes[0].slice(0,200)}${d.sampleQuotes[0].length>200?'…':''}"` : ''}`);
            })
            .on("mousemove", function(event) {
                vis.tooltip.style("left", (event.pageX + 12) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => vis.tooltip.style("visibility", "hidden"));

        // nodes
        const node = vis.svg.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(graph.nodes)
            .enter().append("g")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);

        node.append("rect")
            .attr("height", d => Math.max(6, d.y1 - d.y0))
            .attr("width", d => Math.max(6, d.x1 - d.x0))
            .attr("fill", d => colorFor(d.phase)) // Map color back to base phase mapping rule
            .attr("stroke", "#333")
            .style("opacity", 0.95)
            .on("mouseover", function(event, d) {
                const subs = d.milestones && d.milestones.length ? d.milestones.slice(0,20).join(", ") : "(none)";
                const quotes = d.sampleQuotes && d.sampleQuotes.length ? `<br><em>Sample:</em> "${d.sampleQuotes[0].slice(0,200)}${d.sampleQuotes[0].length>200?'…':''}"` : "";
                vis.tooltip.style("visibility", "visible")
                    .html(`<strong>${d.name}</strong><br>Events: ${d.value}<br><em>milestones:</em> ${subs}${quotes}`);
            })
            .on("mousemove", function(event) {
                vis.tooltip.style("left", (event.pageX + 12) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => vis.tooltip.style("visibility", "hidden"));

    }
}