import {
    Component,
    NgZone,
    OnDestroy,
    OnInit,
    ViewChild,
    ElementRef
} from '@angular/core';
import { GlobalsService } from './globals.service';
import { EventsService } from './events.service';
import { SerialService } from './serial.service';
import { UtilsService } from './utils.service';

import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import fileDialog from 'file-dialog';
//import { saveAs } from 'file-saver';

import * as gIF from './gIF';
import * as gConst from './gConst';

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
    binPath = '- - - - -.bin';

    wrBinTmo: any;
    selBinTmo: any;
    dlBinTmo: any;

    constructor(
        public serial: SerialService,
        public globals: GlobalsService,
        private events: EventsService,
        private utils: UtilsService,
        private http: HttpClient,
        private ngZone: NgZone
    ) {
        // ---
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
     * fn          selBinFile
     *
     * brief
     *
     */
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

    /***********************************************************************************************
     * fn          encryptBin
     *
     * brief
     *
     */
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

    /***********************************************************************************************
     * fn          dlBinFile
     *
     * brief
     *
     */
    dlBinFile() {

        clearTimeout(this.dlBinTmo);
        this.dlBinTmo = setTimeout(()=>{
            this.serial.dlBin();
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
        clearTimeout(this.wrBinTmo);
        this.wrBinTmo = setTimeout(()=>{
            this.serial.writeBin();
            document.getElementById("wrBin")!.blur();
        }, 200);
    }
}
