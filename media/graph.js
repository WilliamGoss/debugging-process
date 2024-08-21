import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

export function createGraph(treeData, vscode, aNode) {
    let data = treeData;
    let activeNode = aNode;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Remove any existing content
    d3.select("#graph").text("");

    // Create SVG
    const svg = d3.select("#graph").append("svg")
        .attr("width", width)
        .attr("height", height);

    const g = svg.append("g");

    // Define hierarchical data
    /*
    const rootData = {
        name: "Root",
        id: 0,
        children: [
            {
                name: "Child 1",
                id: 1,
                children: [
                    { name: "Grandchild 1.1", id: 2, children: [] },
                    { name: "Grandchild 1.2", id: 3, children: [] }
                ]
            },
            {
                name: "Child 2",
                id: 4,
                children: [
                    { name: "Grandchild 2.1", id: 5, children: [] }
                ]
            },
            {
                name: "Child 3",
                id: 6,
                children: [
                    { name: "Grandchild 3.1", id: 7, children: [] },
                    { name: "Grandchild 3.2", id: 8, children: [] },
                    { name: "Grandchild 3.3", id: 9, children: [] }
                ]
            }
        ]
    };
    */

    //active node helper function
    function changeActiveNode(nodeId) {
        activeNode = nodeId; 
        updateActiveNode(nodeId); 
        vscode.postMessage({ command: 'updateActiveNode', activeNode: nodeId});
    };

    // Convert hierarchical data to a tree
    const root = d3.hierarchy(data);
    const treeLayout = d3.tree().size([height - 200, width - 800]);
    treeLayout(root);

    // Define a function to measure text width
    function getTextWidth(text, fontSize = "12px") {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = fontSize + " Arial"; // Default font
        return context.measureText(text).width;
    }

    // Define padding around the text
    const padding = 15;
    const baseNodeHeight = 30; // Base height of the node
    //const baseNodeWidth = d => getTextWidth(d.data.name) + padding;
    //gives a 12 character node size standard
    const baseNodeWidth = d => getTextWidth("abcdefghijkl") + padding;
    const selectedNodeHeight = baseNodeHeight * 5; // Increased height for active node
    const selectedNodeWidth = d => baseNodeWidth(d) * 5; // Increased width for active node

    // Define the force layout simulation
    const simulation = d3.forceSimulation(root.descendants())
        .force("link", d3.forceLink().id(d => d.id).distance(30)) // Control link distance
        .force("charge", d3.forceManyBody().strength(-100)) // Avoid overlapping nodes
        .force("center", d3.forceCenter(width / 2, height / 2));

    // Draw links as straight lines
    g.selectAll('line.link')
        .data(root.links())
        .enter().append('line')
        .attr("class", "link")
        .attr("stroke", "#999")
        .attr("stroke-width", 1);

    // Draw nodes as rectangles
    let selectedNode = null; // To keep track of the active node

    const nodeGroup = g.selectAll('g.node')
        .data(root.descendants())
        .enter().append('g')
        .attr('class', 'node')
        .attr("transform", d => `translate(${d.x}, ${d.y})`);

    const rects = nodeGroup.append('rect')
        .attr("x", d => -baseNodeWidth(d) / 2) // Center the rectangle horizontally
        .attr("y", -baseNodeHeight / 2) // Center the rectangle vertically
        .attr("width", d => baseNodeWidth(d))
        .attr("height", baseNodeHeight)
        .attr("fill", "#fff") // Default node color
        .attr('stroke', d => d.data.id === activeNode ? 'orange' : '#000') // Orange border for active node
        .attr('stroke-width', d => d.data.id === activeNode ? 4 : 1) // Thicker border for active node
        .on("click", (event, d) => handleNodeClick(event, d));

    // Add node labels
    nodeGroup.append('text')
        .attr("x", 0)
        .attr("y", 5) // Adjust y to center text vertically
        .attr("text-anchor", "middle") // Center text horizontally
        .text(d => d.data.name.slice(0, 12))
        .attr("font-size", "12px")
        .attr("fill", "#333")
        .on("click", (event, d) => handleNodeClick(event, d));

    // Add additional info text
    const infoTexts = nodeGroup.append('text')
        .attr("class", "info")
        .attr("x", baseNodeWidth) // Align text horizontally within node
        .attr("y", baseNodeHeight + 10) // Positioned below the node label
        .attr("text-anchor", "middle") // Align text horizontally
        .attr("font-size", "10px")
        //.attr("fill", "#666")
        .style("opacity", 0) // Initially hidden
        .text(d => d.data.name); // Full name field

    // Add buttons to nodes
    const buttonWidth = 60;
    const buttonHeight = 20;

    const buttons = nodeGroup.append('g')
        .attr("class", "button")
        .style("display", "none"); // Initially hidden
        //.style("pointer-events", "all");

    buttons.append('rect')
        .attr("x", d => (selectedNodeWidth(d) / 2) - buttonWidth) // Center the button horizontally within the expanded node
        .attr("y",  selectedNodeHeight - 15) // Position button at the bottom of the node with some padding
        .attr("width", buttonWidth)
        .attr("height", buttonHeight)
        .attr("fill", "#007bff") // Button color
        .attr("stroke", "#0056b3")
        .attr("stroke-width", 1)
        .on("click", (event, d) => changeActiveNode(d.data.id)); // Example button restore

    buttons.append('text')
        .attr("x", d => (selectedNodeWidth(d) - buttonWidth) / 2) // Center text within button
        .attr("y", selectedNodeHeight) // Position text within button
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .attr("fill", "#fff")
        .text("Restore")
        .on("click", (event, d) => changeActiveNode(d.data.id));

    // Function to handle node click
    function handleNodeClick(event, d) {
        if (selectedNode === event.target.closest('g.node')) {
            // Clicked the currently active node: deactivate it
            d3.select(selectedNode).select('rect')
                .transition() // Smooth transition
                .duration(300)
                .attr("fill", "#fff")
                .attr("width", d => baseNodeWidth(d))
                .attr("height", baseNodeHeight); // Reset size

            d3.select(selectedNode).select('.info')
                .transition() // Smooth transition
                .duration(300)
                .style("opacity", 0); // Hide info text

            d3.select(selectedNode).select('.button')
                .style("display", "none"); // Hide button

            selectedNode = null; // Clear active node
        } else {
            if (selectedNode) {
                // Reset previous active node
                d3.select(selectedNode).select('rect')
                    .transition() // Smooth transition
                    .duration(300)
                    .attr("fill", "#fff")
                    .attr("width", d => baseNodeWidth(d))
                    .attr("height", baseNodeHeight); // Reset size

                d3.select(selectedNode).select('.info')
                    .transition() // Smooth transition
                    .duration(300)
                    .style("opacity", 0); // Hide info text

                d3.select(selectedNode).select('.button')
                    .style("display", "none"); // Hide button
            }
            // Set new active node
            selectedNode = event.target.closest('g.node'); // Find the closest <g> element
            d3.select(selectedNode).raise(); // Bring the active node to the front
            d3.select(selectedNode).select('rect')
                .transition() // Smooth transition
                .duration(300)
                .attr("fill", "#1f77b4") // Highlight color
                .attr("width", d => selectedNodeWidth(d))
                .attr("height", selectedNodeHeight); // Further increased size

            d3.select(selectedNode).select('.info')
                .transition() // Smooth transition
                .duration(300)
                .style("opacity", 1); // Show info text

            d3.select(selectedNode).select('.button')
                .style("display", "block") // Show button
                .transition() // Smooth transition for button appearance
                .duration(900)
                .style("display", "block"); // Ensure button is displayed
        }
    }

    function updateActiveNode(newActiveNodeId) {
        // Remove the orange border from the previously active node
        d3.selectAll('g.node').select('rect')
            .transition()
            .duration(300)
            .attr("stroke", "#000") // Reset border color to black or default color
            .attr("stroke-width", 1); // Reset border width
        
        activeNode = newActiveNodeId;

        // Apply orange border to the new active node
        d3.selectAll(`g.node`)
            .filter(d => d.data.id === newActiveNodeId)
            .select('rect')
            .transition()
            .duration(300)
            .attr("stroke", "#FFA500") // Set border color to orange
            .attr("stroke-width", 4); // Set border width
    }
    

    // Function to update the positions of nodes and links
    function update() {
        g.selectAll('line.link')
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        g.selectAll('g.node')
            .attr("transform", d => `translate(${d.x}, ${d.y})`);
    }

    // Update positions on every tick
    simulation.on("tick", update);

    // Initialize zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.5, 2]) // Set zoom scale limits
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
        });

    svg.call(zoom);
}
