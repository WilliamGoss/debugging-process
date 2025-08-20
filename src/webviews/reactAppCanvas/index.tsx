import React from 'react';
import ReactDOM from 'react-dom/client';
import NodeCanvas from './App';

let nodes = [
    {
      text: "isn't working correctly",
      id: 0,
      commitId: "cd8890c51dbacfa61284588d2a9d7a3c9a0956b4",
      branchId: "master",
      x: 0,
      y: 0,
      children: [1],
      visible: true,
      output: "Perished",
      error: "None"
    },
    {
      text: "The constructor now initializes health with the value passed instead of negating it, and a print statement for current health was added in the checkAlive method.",
      id: 1,
      commitId: "a159e1047ec7fb2bba4589be6ff986b4a319fa7d",
      branchId: "master",
      x: 100, // slightly to the right of the first node
      y: 100, // slightly below
      children: [2],
      visible: true,
      output: "Perished",
      error: "Blah blah run time error"
    },
    {
      text: "The code changes remove the health print statement from the checkAlive method, add a print statement for the amount in the addArmor method, and clarify the logic for checking the player's status.",
      id: 2,
      commitId: "4872097cfaad13a9be35aa62566e18bcf08a3364",
      branchId: "master",
      x: 200, // right of node 1
      y: 200, // slightly lower
      children: [3],
      visible: true,
      output: "Perished",
      error: "None"
    },
    {
      text: "The addArmor method now includes a conditional check to ensure armor is only added if the amount is greater than zero.",
      id: 3,
      commitId: "8f2a5fd07531a4ccbeb4f72a7cc83618f3d889dc",
      branchId: "master",
      x: 300, // right of node 2
      y: 300, // slightly lower
      children: [],
      visible: true,
      output: "Perished",
      error: "None"
    }
  ];
  
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<NodeCanvas nodes={nodes} />);
