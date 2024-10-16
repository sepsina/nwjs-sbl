import {
    Component,
    NgZone,
    OnDestroy,
    OnInit,
    ViewChild,
    ElementRef
} from '@angular/core';
import { EventsService } from './events.service';
import { SerialService } from './serial.service';
import { UtilsService } from './utils.service';
import { NetService } from './net.service';

import { CommonModule } from '@angular/common';

import * as gIF from './gIF';
import * as gConst from './gConst';

const PAGE_SIZE = 512;
const NO_BIN = '- - -.bin';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [
        CommonModule,
    ],
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {

    @ViewChild('cbScroll') cbScroll!: ElementRef;
    @ViewChild('logList') logList!: ElementRef;

    logs = [] as gIF.msgLogs_t[];
    scrollFlag = false;

    startFlag = true;
    binPath = NO_BIN;
    bin_bar = 0;

    wrBinTmo: any;
    selBinTmo: any;
    dlBinTmo: any;

    bin_img = new Uint8Array(256*1024);
    img_idx = 0;
    page = 0;

    rxBuf = new Uint8Array(1024);
    txBuf = new Uint8Array(1024);
    rwBuf = new gIF.rwBuf_t();

    constructor(
        public serial: SerialService,
        public net: NetService,
        private events: EventsService,
        private utils: UtilsService,
        private ngZone: NgZone
    ) {
        this.rwBuf.wrBuf = new DataView(this.txBuf.buffer);
    }

    /***********************************************************************************************
     * fn          ngOnDestroy
     *
     * brief
     *
     */
    ngOnDestroy() {
        this.serial.closeComPort();
    }

    /***********************************************************************************************
     * fn          ngOnInit
     *
     * brief
     *
     */
    ngOnInit() {
        window.onbeforeunload = ()=>{
            this.ngOnDestroy();
        };

        this.events.subscribe('closePort', (msg: string)=>{
            if(msg == 'close'){
                this.startFlag = true;
            }
        });

        this.events.subscribe('logMsg', (msg: gIF.msgLogs_t)=>{
            const logsLen = this.logs.length;
            const last = this.logs[logsLen - 1];
            if(logsLen && (last.id === 7) && (msg.id === 7)){
                this.ngZone.run(()=>{
                    this.logs[logsLen - 1] = msg;
                });
            }
            else {
                while(this.logs.length >= 20) {
                    this.logs.shift();
                }
                this.ngZone.run(()=>{
                    this.logs.push(msg);
                });
            }
            if(this.scrollFlag == true) {
                this.logList.nativeElement.scrollTop = this.logList.nativeElement.scrollHeight;
            }
        });

        this.events.subscribe('bin_info', (info: gIF.binInfo_t)=>{

            let bin_path = '';
            switch(info.status){
                case gConst.DL_OK: {
                    bin_path = `${info.file} (${info.size} bytes)`;
                    this.utils.sendMsg('--- 100.0% ---', gConst.GREEN, 7);
                    break;
                }
                case gConst.DL_SHA_NOT_VALID: {
                    bin_path = NO_BIN;
                    this.utils.sendMsg('*** not valid sha256 ***', gConst.RED);
                    break;
                }
                case gConst.DL_NO_PART: {
                    bin_path = NO_BIN;
                    this.utils.sendMsg('*** no valid device ***', gConst.RED);
                    break;
                }
                case gConst.DL_FAIL: {
                    bin_path = NO_BIN;
                    this.utils.sendMsg('*** bin download failed ***', gConst.RED);
                    break;
                }
                case gConst.WR_OK: {
                    this.utils.sendMsg('--- 100.0% ---', gConst.GREEN, 7);
                    break;
                }
                case gConst.WR_FAIL: {
                    // ---
                    break;
                }
            }
            this.ngZone.run(()=>{
                if(bin_path){
                    this.binPath = bin_path;
                }
                this.bin_bar = 0;
            });
        });

        this.events.subscribe('bin_bar', (val: number)=>{
            this.ngZone.run(()=>{
                this.bin_bar = val;
            });
            this.utils.sendMsg(`--- ${this.bin_bar.toFixed(1)}% ---`, gConst.GREEN, 7);
        });

        this.events.subscribe('new_part', (part: number)=>{
            this.net.numPages = 0;
            this.ngZone.run(()=>{
                this.binPath = NO_BIN;
            });
        });
    }

    /***********************************************************************************************
     * fn          autoScroll
     *
     * brief
     *
     */
    autoScrollChange() {

        if(this.cbScroll.nativeElement.checked) {
            this.scrollFlag = true;
            this.logList.nativeElement.scrollTop = this.logList.nativeElement.scrollHeight;
        }
        else {
            this.scrollFlag = false;
        }
    }

    /***********************************************************************************************
     * fn          clearLogs
     *
     * brief
     *
     */
    clearLogs() {
        this.logs = [];
        setTimeout(()=>{
            document.getElementById("clr_logs")!.blur();
        }), 200;
    }


    /***********************************************************************************************
     * fn          dlBinFile
     *
     * brief
     *
     */
    dlBinFile() {

        if(this.net.busy_flag == true){
            this.utils.sendMsg('*** udp busy ***', gConst.CHOCOLATE);
            document.getElementById("selBin")!.blur();
            return;
        }
        if(this.serial.wrBinFlag == true){
            this.utils.sendMsg(`*** serial busy ***`, gConst.CHOCOLATE);
            document.getElementById("selBin")!.blur();
            return;
        }
        // uncomment after testing
        /*
        if(this.serial.partNum == 0){
            this.utils.sendMsg('no valid device!', gConst.RED);
            document.getElementById("selBin")!.blur();
            return;
        }
        */
        clearTimeout(this.dlBinTmo);
        this.dlBinTmo = setTimeout(()=>{
            this.net.dl_bin();
            document.getElementById("selBin")!.blur();
        }, 200);
    }

    /***********************************************************************************************
     * fn          writeBin
     *
     * brief
     *
     */
    writeBin() {

        if(this.serial.portOpenFlag == false){
            this.utils.sendMsg(`*** no port open ***`, gConst.CHOCOLATE);
            document.getElementById("wrBin")!.blur();
            return;
        }
        if(this.net.numPages == 0){
            this.utils.sendMsg('*** get valid bin ***', gConst.CHOCOLATE);
            document.getElementById("wrBin")!.blur();
            return;
        }
        if(this.net.busy_flag == true){
            this.utils.sendMsg('*** udp busy ***', gConst.CHOCOLATE);
            document.getElementById("wrBin")!.blur();
            return;
        }
        if(this.serial.wrBinFlag == true){
            this.utils.sendMsg(`*** serial busy ***`, gConst.CHOCOLATE);
            document.getElementById("wrBin")!.blur();
            return;
        }

        clearTimeout(this.wrBinTmo);
        this.wrBinTmo = setTimeout(()=>{
            this.serial.writeBin();
            document.getElementById("wrBin")!.blur();
        }, 200);
    }

    /***********************************************************************************************
     * fn          selBinFile
     *
     * brief
     *
     *
    selBinFile() {
        clearTimeout(this.selBinTmo);
        this.selBinTmo = setTimeout(()=>{
            fileDialog({ multiple: false, accept: '.bin'}).then((files)=>{
                const file: any = files[0];
                if(file){
                    this.binPath = file.name;
                    this.utils.sendMsg(`bin path: ${file.path}`);
                    this.serial.readBin(file.path);
                }
            });
            document.getElementById("selBin")!.blur();
        }, 200);
    }
    */
    /***********************************************************************************************
     * fn          encryptBin
     *
     * brief
     *
     *
    encryptBin(){
        clearTimeout(this.selBinTmo);
        this.selBinTmo = setTimeout(()=>{
            fileDialog({ multiple: false, accept: '.bin'}).then((files)=>{
                const file: any = files[0];
                if(file){
                    this.binPath = file.name;
                    this.utils.sendMsg(`bin path: ${file.path}`);
                    this.serial.encBin(file.path);
                }
            });
            document.getElementById("selBin")!.blur();
        }, 200);
    }
    */
}
