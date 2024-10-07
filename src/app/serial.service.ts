///<reference types="chrome"/>
//'use strict';
import { Injectable, NgZone } from '@angular/core';
import { EventsService } from './events.service';
import { GlobalsService } from './globals.service';
import { UtilsService } from './utils.service';
import * as gIF from './gIF';
import * as gConst from './gConst';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

const ORANGE = 'orangered';
const RED = 'red';
const GREEN = 'green';
const BLUE = 'blue';
const OLIVE = 'olive';
const PURPLE = 'purple'
const CHOCOLATE = 'chocolate';

// cbc-key-12345678
const key = [
    0x63,0x62,0x63,0x2D,
    0x6B,0x65,0x79,0x2D,
    0x31,0x32,0x33,0x34,
    0x35,0x36,0x37,0x38
];

// cbc-iv-123456789
const iv = [
    0x63,0x62,0x63,0x2D,
    0x69,0x76,0x2D,0x31,
    0x32,0x33,0x34,0x35,
    0x36,0x37,0x38,0x39
];


// cigldeker-101967
const test_data = [
    0x63,0x69,0x67,0x6C,
    0x64,0x65,0x6B,0x65,
    0x72,0x2D,0x31,0x30,
    0x31,0x39,0x36,0x37
];

// TEST
const ssrURL = 'https://www.dropbox.com/scl/fi/zs1a05dhxzwpu6ebwgp8x/enc.bin?rlkey=xudhvq5093wr9ex5hnsxdgmgq&st=1jo659ut&dl=1';

const FLASH_PAGE_SIZE = 512;
const PART_DESC_LEN = 16;

@Injectable({
    providedIn: 'root',
})
export class SerialService {

    public searchPortFlag = false;
    validPortFlag = false;
    portOpenFlag = false;
    private portIdx = 0;
    portPath = '';

    private testPortTMO: any;
    private findPortTMO: any;

    private crc = 0;
    private calcCRC = 0;
    private msgIdx = 0;
    private isEsc = false;

    private rxState = gIF.eRxState.E_STATE_RX_WAIT_START;

    private msgType = 0;
    private msgLen = 0;
    private seqNum = 0;

    private comFlag = false;
    private comPorts: chrome.serial.DeviceInfo[] = [];
    private connID = -1;

    rxBuf = new Uint8Array(1024);
    txBuf = new Uint8Array(1024);
    rwBuf = new gIF.rwBuf_t();

    slMsg = {} as gIF.slMsg_t;

    partNum = 0;

    binData!: Uint8Array;
    binFlag = false;
    binPage = 0;
    wrBinFlag = false;
    binProgress = 0;

    flashPagesNum = 0;

    fs: any;
    aes_js: any;

    constructor(
        private events: EventsService,
        private globals: GlobalsService,
        private utils: UtilsService,
        private http: HttpClient,
        private ngZone: NgZone
    ) {
        chrome.serial.onReceive.addListener((info)=>{
            if(info.connectionId === this.connID){
                this.slOnData(info.data);
            }
        });
        chrome.serial.onReceiveError.addListener((info: any)=>{
                this.rcvErrCB(info);
        });

        this.fs = window.nw.require('fs');
        this.aes_js = window.nw.require('aes-js');
        /*
        setTimeout(()=>{
            this.checkCom();
        }, 15000);
        */
        this.rwBuf.wrBuf = new DataView(this.txBuf.buffer);

        setTimeout(()=>{
            this.listComPorts();
        }, 1000);
    }

    /***********************************************************************************************
     * fn          checkCom
     *
     * brief
     *
     */
    async checkCom() {
        if(this.comFlag == false) {
            await this.closeComPort();
        }
        this.comFlag = false;
        setTimeout(()=>{
            this.checkCom();
        }, 30000);
    }

    /***********************************************************************************************
     * fn          closeComPort
     *
     * brief
     *
     */
    async closeComPort() {
        if(this.connID > -1){
            this.utils.sendMsg('close port', RED);
            this.events.publish('closePort', 'close');

            const result = await this.closePortAsync(this.connID);
            if(result){
                this.connID = -1;
                this.portOpenFlag = false;
                this.validPortFlag = false;
                clearTimeout(this.findPortTMO);
                this.findPortTMO = setTimeout(() => {
                    this.findComPort();
                }, 300);
            }
        }
    }

    /***********************************************************************************************
     * fn          closePortAsync
     *
     * brief
     *
     */
    closePortAsync(id: number) {
        return new Promise((resolve)=>{
            chrome.serial.disconnect(id, (result)=>{
                resolve(result);
            });
        });
    }

    /***********************************************************************************************
     * fn          listComPorts
     *
     * brief
     *
     */
    listComPorts() {
        chrome.serial.getDevices((ports)=>{
            /*
            for(let i = 0; i < ports.length; i++){
                if(ports[i].vendorId){
                    if(ports[i].productId){
                        this.comPorts.push(ports[i]);
                    }
                }
            }
            */
            this.comPorts = ports;
            if(this.comPorts.length) {
                this.searchPortFlag = true;
                this.portIdx = 0;
                clearTimeout(this.findPortTMO);
                this.findPortTMO = setTimeout(()=>{
                    this.findComPort();
                }, 200);
            }
            else {
                this.searchPortFlag = false;
                setTimeout(()=>{
                    this.listComPorts();
                }, 2000);
                this.utils.sendMsg('no com ports', RED, 7);
            }
        });
    }

    /***********************************************************************************************
     * fn          findComPort
     *
     * brief
     *
     */
    async findComPort() {

        if(this.validPortFlag === true){
            return;
        }
        if(this.searchPortFlag === false){
            setTimeout(()=>{
                this.listComPorts();
            }, 1000);
            return;
        }
        this.portPath = this.comPorts[this.portIdx].path;
        this.utils.sendMsg(`testing: ${this.portPath}`, BLUE);
        let connOpts = {
            bitrate: 115200
        };
        const connInfo: any = await this.serialConnectAsync(connOpts);
        if(connInfo){
            this.connID = connInfo.connectionId;
            this.portOpenFlag = true;
            this.testPortTMO = setTimeout(()=>{
                this.closeComPort();
            }, 1500);
            setTimeout(() => {
                this.testPortReq();
            }, 10);
        }
        else {
            this.utils.sendMsg(`err: ${chrome.runtime.lastError?.message}`, RED);
            clearTimeout(this.findPortTMO);
            this.findPortTMO = setTimeout(() => {
                this.findComPort();
            }, 300);
        }
        this.portIdx++;
        if(this.portIdx >= this.comPorts.length) {
            this.searchPortFlag = false;
        }
    }

    /***********************************************************************************************
     * fn          serialConnectAsync
     *
     * brief
     *
     */
    serialConnectAsync(connOpt: any) {
        return new Promise((resolve)=>{
            chrome.serial.connect(this.portPath, connOpt, (connInfo)=>{
                resolve(connInfo);
            });
        });
    }

    /***********************************************************************************************
     * fn          slOnData
     *
     * brief
     *
     */
    private slOnData(msg: any) {

        let pkt = new Uint8Array(msg);

        for(let i = 0; i < pkt.length; i++) {
            let rxByte = pkt[i];
            switch(rxByte) {
                case gConst.SL_START_CHAR: {
                    this.msgIdx = 0;
                    this.isEsc = false;
                    this.rxState = gIF.eRxState.E_STATE_RX_WAIT_TYPELSB;
                    break;
                }
                case gConst.SL_ESC_CHAR: {
                    this.isEsc = true;
                    break;
                }
                case gConst.SL_END_CHAR: {
                    if(this.crc == this.calcCRC) {
                        this.slMsg.type = this.msgType;
                        this.slMsg.msg = this.rxBuf.slice(0, this.msgLen);
                        this.processMsg(this.slMsg);
                    }
                    this.rxState = gIF.eRxState.E_STATE_RX_WAIT_START;
                    break;
                }
                default: {
                    if(this.isEsc == true) {
                        rxByte ^= 0x10;
                        this.isEsc = false;
                    }
                    switch(this.rxState) {
                        case gIF.eRxState.E_STATE_RX_WAIT_START: {
                            // ---
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_TYPELSB: {
                            this.msgType = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_TYPEMSB;
                            this.calcCRC = rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_TYPEMSB: {
                            this.msgType += rxByte << 8;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_LENLSB;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_LENLSB: {
                            this.msgLen = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_LENMSB;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_LENMSB: {
                            this.msgLen += rxByte << 8;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_CRC;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_CRC: {
                            this.crc = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_DATA;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_DATA: {
                            if(this.msgIdx < this.msgLen) {
                                this.rxBuf[this.msgIdx++] = rxByte;
                                this.calcCRC ^= rxByte;
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    /***********************************************************************************************
     * fn          processMsg
     *
     * brief
     *
     */
    private processMsg(slMsg: gIF.slMsg_t) {

        this.rwBuf.rdBuf = new DataView(slMsg.msg.buffer);
        this.rwBuf.rdIdx = 0;

        switch(slMsg.type) {
            case gConst.SL_MSG_TESTPORT: {
                let idNum = 0;
                let msgSeqNum = this.rwBuf.read_uint8();
                if(msgSeqNum == this.seqNum) {
                    idNum = this.rwBuf.read_uint32_LE();
                    if(idNum === 0x67190110) {
                        clearTimeout(this.testPortTMO);
                        this.validPortFlag = true;
                        this.searchPortFlag = false;
                        this.utils.sendMsg('port valid', GREEN);
                        setTimeout(()=>{
                            this.rdPartNum();
                        }, 0);
                    }
                }
                break;
            }
            case gConst.SL_MSG_USB_CMD: {
                let msgSeqNum = this.rwBuf.read_uint8();
                if(msgSeqNum == this.seqNum) {
                    let cmdID = this.rwBuf.read_uint8();
                    switch(cmdID) {
                        case gConst.USB_CMD_WR_PAGE: {
                            let status = this.rwBuf.read_uint8();
                            switch(status){
                                case gConst.FLASH_STATUS_OK: {
                                    this.binPage++;
                                    if(this.binPage < this.flashPagesNum){
                                        setTimeout(()=>{
                                            this.wrFlashPageReq();
                                        }, 10);
                                    }
                                    else {
                                        setTimeout(()=>{
                                            this.writeBinDone();
                                        }, 10);
                                    }
                                    break;
                                }
                                case gConst.FLASH_STATUS_INIT_FAIL: {
                                    this.utils.sendMsg("flash err: init fail", RED);
                                    break;
                                }
                                case gConst.FLASH_STATUS_ERASE_FAIL: {
                                    this.utils.sendMsg("flash err: erase fail", RED);
                                    break;
                                }
                                case gConst.FLASH_STATUS_PROG_FAIL: {
                                    this.utils.sendMsg("flash err: prog fail", RED);
                                    break;
                                }
                                case gConst.FLASH_STATUS_VERIFY_FAIL: {
                                    this.utils.sendMsg("flash err: verify fail", RED);
                                    break;
                                }
                                default: {
                                    this.utils.sendMsg("flash err: unsuported", RED);
                                    break;
                                }
                            }
                            break;
                        }
                        case gConst.USB_CMD_READ_PART_NUM: {
                            this.partNum = this.rwBuf.read_uint32_LE();
                            this.utils.sendMsg(`part num: ${this.partNum}`, BLUE);
                            break;
                        }
                        default: {
                            // ---
                        }
                    }
                }
                break;
            }
            case gConst.SL_MSG_LOG: {
                let log_msg = '';
                let chrCode: number
                for(let i = 0; i < slMsg.msg.byteLength; i++) {
                    chrCode = this.rwBuf.read_uint8();
                    if(chrCode != 0) {
                        log_msg += String.fromCharCode(chrCode);
                    }
                }
                this.utils.sendMsg(log_msg, ORANGE);
                break;
            }
        }
    }

    /***********************************************************************************************
     * fn          testPortReq
     *
     * brief
     *
     */
    async testPortReq() {

        this.seqNum = ++this.seqNum % 256;
        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(gConst.SL_MSG_TESTPORT);
        this.rwBuf.write_uint16_LE(0); // len
        this.rwBuf.write_uint8(0);     // CRC
        // cmd data
        this.rwBuf.write_uint8(this.seqNum);
        this.rwBuf.write_uint32_LE(0x67190110);

        let msgLen = this.rwBuf.wrIdx;
        let dataLen = msgLen - gConst.HEAD_LEN;
        this.rwBuf.modify_uint16_LE(dataLen, gConst.LEN_IDX);
        let crc = 0;
        for(let i = 0; i < msgLen; i++) {
            crc ^= this.txBuf[i];
        }
        this.rwBuf.modify_uint8(crc, gConst.CRC_IDX);

        await this.serialSend(msgLen);
    }

    /***********************************************************************************************
     * fn          serialSend
     *
     * brief
     *
     */
    async serialSend(msgLen: number) {

        let slMsgBuf = new Uint8Array(1024);
        let msgIdx = 0;

        slMsgBuf[msgIdx++] = gConst.SL_START_CHAR;
        for(let i = 0; i < msgLen; i++) {
            if(this.txBuf[i] < 0x10) {
                this.txBuf[i] ^= 0x10;
                slMsgBuf[msgIdx++] = gConst.SL_ESC_CHAR;
            }
            slMsgBuf[msgIdx++] = this.txBuf[i];
        }
        slMsgBuf[msgIdx++] = gConst.SL_END_CHAR;

        let slMsgLen = msgIdx;
        let slMsg = slMsgBuf.slice(0, slMsgLen);

        const sendInfo: any = await this.serialSendAsync(slMsg);
        if(sendInfo.error){
            this.utils.sendMsg(`send err: ${sendInfo.error}`, RED);
        }
    }

    /***********************************************************************************************
     * fn          serialSendAsync
     *
     * brief
     *
     */
    serialSendAsync(slMsg: any) {
        return new Promise((resolve)=>{
            chrome.serial.send(this.connID, slMsg.buffer, (sendInfo: any)=>{
                resolve(sendInfo);
            });
        });
    }

    /***********************************************************************************************
     * fn          rcvErrCB
     *
     * brief
     *
     */
    async rcvErrCB(info: any) {
        if(info.connectionId === this.connID){
            switch(info.error){
                case 'disconnected': {
                    this.utils.sendMsg(`${this.portPath} disconnected`);
                    setTimeout(()=>{
                        this.closeComPort();
                    }, 10);
                    break;
                }
                case 'device_lost': {
                    this.utils.sendMsg(`${this.portPath} lost`, RED);
                    setTimeout(()=>{
                        this.closeComPort();
                    }, 10);
                    break;
                }
                case 'system_error': {
                    break;
                }
                case 'timeout':
                case 'break':
                case 'frame_error':
                case 'overrun':
                case 'buffer_overflow':
                case 'parity_error': {
                    // ---
                    break;
                }
            }
        }
    }

    /***********************************************************************************************
     * fn          readBin
     *
     * brief
     *
     */
    readBin(path: string) {

        if(this.wrBinFlag == true){
            this.utils.sendMsg(`busy`, CHOCOLATE);
            return;
        }
        this.binData = this.fs.readFileSync(path);
        if(this.binData){
            const len = this.binData.length - PART_DESC_LEN;
            const partDesc = new Uint8Array(PART_DESC_LEN);
            for(let i = 0, idx = len; i < PART_DESC_LEN; i++, idx++){
                partDesc[i] = this.binData[idx];
            }
            this.rwBuf.rdBuf = new DataView(partDesc.buffer);
            this.rwBuf.rdIdx = 0;
            const binPartNum = this.rwBuf.read_uint32_LE();
            console.log(`bin part num: ${binPartNum}`);
            if(this.partNum == binPartNum){
                this.binFlag = true;
                this.flashPagesNum = Math.floor(len / FLASH_PAGE_SIZE);
            }
        }
    }

    /***********************************************************************************************
     * fn          dlBin
     *
     * brief
     *
     */
    dlBin() {

        if(this.wrBinFlag == true){
            this.utils.sendMsg(`busy`, CHOCOLATE);
            return;
        }
        this.http.get(ssrURL, {
            responseType: 'blob'
        }).subscribe({
            next: async (blob)=>{
                this.binData = new Uint8Array(await blob.arrayBuffer());
                const len = this.binData.length - PART_DESC_LEN;
                const partData = this.binData.slice(len);
                this.rwBuf.rdBuf = new DataView(partData.buffer);
                this.rwBuf.rdIdx = 0;
                const binPartNum = this.rwBuf.read_uint32_LE();
                console.log(`bin part num: ${binPartNum}`);
                if(this.partNum == binPartNum){
                    this.binFlag = true;
                    this.flashPagesNum = Math.floor(len / FLASH_PAGE_SIZE);
                }
            },
            error: (err: HttpErrorResponse)=>{
                this.utils.sendMsg(`${err.name}: ${err.status}`, 'red');
            }
        });
    }

    /***********************************************************************************************
     * fn          writeBin
     *
     * brief
     *
     */
    writeBin() {

        if(this.binFlag == false){
            this.utils.sendMsg(`select bin file`, CHOCOLATE);
            return;
        }
        if(this.wrBinFlag == true){
            this.utils.sendMsg(`busy`, CHOCOLATE);
            return;
        }
        if(this.portOpenFlag == false){
            this.utils.sendMsg(`no port open`, CHOCOLATE);
            return;
        }
        this.ngZone.run(()=>{
            this.wrBinFlag = true;
            this.binProgress = 0;
        });

        setTimeout(() => {
            this.binPage = 0;
            this.wrFlashPageReq();
        }, 10);
    }

    /***********************************************************************************************
     * fn          wrFlashPageReq
     *
     * brief
     *
     */
    async wrFlashPageReq() {

        this.seqNum = ++this.seqNum % 256;
        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(gConst.SL_MSG_USB_CMD);
        this.rwBuf.write_uint16_LE(0); // len
        this.rwBuf.write_uint8(0);     // CRC
        // cmd data
        this.rwBuf.write_uint8(this.seqNum);
        this.rwBuf.write_uint8(gConst.USB_CMD_WR_PAGE);
        this.rwBuf.write_uint32_LE(this.binPage);

        let binIdx = this.binPage * FLASH_PAGE_SIZE;
        for(let i = 0; i < FLASH_PAGE_SIZE; i++){
            this.rwBuf.write_uint8(this.binData[binIdx++]);
        }

        this.ngZone.run(()=>{
            this.binProgress = 100 * this.binPage / this.flashPagesNum;
        });
        this.utils.sendMsg(`--- ${this.binProgress.toFixed(1)}% ---`, GREEN, 7);

        let msgLen = this.rwBuf.wrIdx;
        let dataLen = msgLen - gConst.HEAD_LEN;
        this.rwBuf.modify_uint16_LE(dataLen, gConst.LEN_IDX);
        let crc = 0;
        for(let i = 0; i < msgLen; i++) {
            crc ^= this.txBuf[i];
        }
        this.rwBuf.modify_uint8(crc, gConst.CRC_IDX);

        await this.serialSend(msgLen);
    }

    /***********************************************************************************************
     * fn          writeBinDone
     *
     * brief
     *
     */
    writeBinDone() {

        this.binPage = 0;

        this.ngZone.run(()=>{
            this.wrBinFlag = false;
            this.binProgress = 0;
            this.utils.sendMsg(`--- 100% ---`, GREEN, 7);
        });
    }

    /***********************************************************************************************
     * fn          rdPartNumReq
     *
     * brief
     *
     */
    async rdPartNum() {

        this.seqNum = ++this.seqNum % 256;
        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(gConst.SL_MSG_USB_CMD);
        this.rwBuf.write_uint16_LE(0); // len
        this.rwBuf.write_uint8(0);     // CRC
        // cmd data
        this.rwBuf.write_uint8(this.seqNum);
        this.rwBuf.write_uint8(gConst.USB_CMD_READ_PART_NUM);

        let msgLen = this.rwBuf.wrIdx;
        let dataLen = msgLen - gConst.HEAD_LEN;
        this.rwBuf.modify_uint16_LE(dataLen, gConst.LEN_IDX);
        let crc = 0;
        for(let i = 0; i < msgLen; i++) {
            crc ^= this.txBuf[i];
        }
        this.rwBuf.modify_uint8(crc, gConst.CRC_IDX);

        await this.serialSend(msgLen);
    }

    /***********************************************************************************************
     * fn          encBin
     *
     * brief
     *
     */
    encBin(path: string) {

        let i = 0;
        let rd_idx = 0;
        let n_read = 0;
        let wr_idx = 0;
        let encChunk: any;
        const rdBuf = new Uint8Array(FLASH_PAGE_SIZE);

        try {
            const fdBin = this.fs.openSync(path, 'r');
            const fdEnc = this.fs.openSync('c:/serfa/trash/enc.bin', 'w');
            while(1){
                n_read = this.fs.readSync(fdBin, rdBuf, 0, FLASH_PAGE_SIZE, rd_idx);
                rd_idx += n_read;
                if(n_read == 0){
                    break; // exit while loop
                }
                if(n_read < FLASH_PAGE_SIZE){
                    for(i = n_read; i < FLASH_PAGE_SIZE; i++){
                        rdBuf[i] = 0xFF;
                    }
                }
                const cbc = new this.aes_js.ModeOfOperation.cbc(key, iv);
                encChunk = cbc.encrypt(rdBuf);
                this.fs.writeSync(fdEnc, encChunk, 0, FLASH_PAGE_SIZE, wr_idx);
                wr_idx += FLASH_PAGE_SIZE;
            }
            this.fs.closeSync(fdBin);
            // add part description
            this.rwBuf.wrIdx = 0;
            this.rwBuf.write_uint32_LE(900);
            for(let i = this.rwBuf.wrIdx; i < PART_DESC_LEN; i++){
                this.rwBuf.write_uint8(0xFF);
            }
            this.fs.writeSync(fdEnc, this.txBuf.slice(0, PART_DESC_LEN), 0, PART_DESC_LEN, wr_idx);
            this.fs.closeSync(fdEnc);
        }
        catch (err) {
            console.log(err)
        }
    }

}
