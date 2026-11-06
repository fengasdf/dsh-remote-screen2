// Machine sources for the remote-screen plugin.
//
// 1. dsh-remote's registry ($DSH_HOME/remote-workspaces/machines.json) when the
//    user already keeps SSH machines there — same machines, no second address
//    book.
// 2. Otherwise $DSH_HOME/remote-screen.json, so the plugin also works on its
//    own:
//      {
//        "machines": [
//          { "id": "vm1", "name": "Build VM", "host": "192.168.1.5",
//            "username": "dev", "rdpPort": 3389, "guacdPort": 4822, "vncPort": 5900 }
//        ]
//      }
//    (a bare array is accepted too; only id/host are required)
//
// The stored dsh-remote password never leaves this module.

import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

export function machinesFile() {
  return path.join(dshHome(), 'remote-workspaces', 'machines.json')
}

export function ownMachinesFile() {
  return path.join(dshHome(), 'remote-screen.json')
}

function normalize(machine) {
  if (!machine || typeof machine.id !== 'string' || typeof machine.host !== 'string') return null
  return {
    id: machine.id,
    name: typeof machine.name === 'string' && machine.name ? machine.name : machine.host,
    host: machine.host,
    port: Number(machine.port) || 22,
    username: typeof machine.username === 'string' ? machine.username : '',
    rdpPort: Number(machine.rdpPort) || 3389,
    guacdPort: Number(machine.guacdPort) || 4822,
    vncPort: Number(machine.vncPort) || 5900,
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @returns {Array<{ id: string, name: string, host: string, port: number, username: string, rdpPort: number, guacdPort: number, vncPort: number }>}
 */
export function loadMachines() {
  // 1. dsh-remote's registry (its file has { list: [...] }).
  const remote = readJson(machinesFile())
  if (remote && Array.isArray(remote.list) && remote.list.length > 0) {
    return remote.list.map(normalize).filter(Boolean)
  }

  // 2. the plugin's own file: { machines: [...] } or [...].
  const own = readJson(ownMachinesFile())
  const list = Array.isArray(own) ? own : Array.isArray(own?.machines) ? own.machines : []
  return list.map(normalize).filter(Boolean)
}

export function findMachine(id) {
  if (typeof id !== 'string' || !id) return undefined
  return loadMachines().find((machine) => machine.id === id)
}
