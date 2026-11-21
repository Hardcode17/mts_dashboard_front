import test from 'node:test'
import assert from 'node:assert/strict'
import {minuteSeries} from '../src/control-room/shiftSummary.ts'
import {queueActivity} from '../src/desk/queueActivity.ts'
test('the live indicators reconstruct observed P4 flow including exits',()=>{
  const now=100000
  const changes=[[39500,'old',true],[40001,'a',false],[70000,'b',true],[now,'b',false]].map(([at,key,entered],i)=>({id:String(i),queue:'critical',at,key,entered,reason:'test'}))
  const a=queueActivity(changes,now).critical
  const s=minuteSeries(0,a,now)
  assert.equal(s.trend[0],1);assert.equal(s.trend.at(-1),0)
  assert.equal(s.outs[0],1);assert.equal(s.outs[59],1);assert.equal(s.ins.reduce((x,y)=>x+y,0),1)
  assert(minuteSeries(479,queueActivity([],now).critical,now).trend.every(n=>n===479))
})
