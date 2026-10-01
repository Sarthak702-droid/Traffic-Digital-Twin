import {useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {Button} from "@/components/ui/button";

export function ReplayStart({hasRun, disabled, onStart}: {hasRun:boolean; disabled:boolean; onStart:()=>void}) {
  const [confirming,setConfirming]=useState(false);
  return <Dialog.Root open={confirming} onOpenChange={setConfirming}>
    <Button disabled={disabled} onClick={()=>{if(hasRun)setConfirming(true);else onStart();}}>Start golden replay</Button>
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay"/>
      <Dialog.Content className="sheet">
        <Dialog.Title>Replace run with prerecorded replay</Dialog.Title>
        <Dialog.Description>The current run ends. Replay uses recorded model output, is visibly labeled, and cannot authorize virtual signal changes.</Dialog.Description>
        <Button disabled={disabled} onClick={()=>{setConfirming(false);onStart();}}>Replace run and start labeled replay</Button>
        <Dialog.Close asChild><Button variant="outline">Cancel</Button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
