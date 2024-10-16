///<reference types="chrome"/>
//'use strict';
import { Injectable } from '@angular/core';
import { EventsService } from './events.service';
import { NetService } from './net.service';
import { GlobalsService } from './globals.service';
import { UtilsService } from './utils.service';
import * as gIF from './gIF';
import * as gConst from './gConst';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

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

    prevPartNum = 0;
    partNum = 0;

    binData!: Uint8Array;
    binFlag = false;
    binPage = 0;
    wrBinFlag = false;

    flashPagesNum = 0;

    fs: any;

    constructor(
        private events: EventsService,
        private globals: GlobalsService,
        private utils: UtilsService,
        private http: HttpClient,
        private net: NetService
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
            this.utils.sendMsg('close port', gConst.RED);
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
                this.utils.sendMsg('no com ports', gConst.RED, 7);
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
        this.utils.sendMsg(`testing: ${this.portPath}`, gConst.BLUE);
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
            this.utils.sendMsg(`err: ${chrome.runtime.lastError?.message}`, gConst.RED);
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
                        this.utils.sendMsg('port valid', gConst.GREEN);
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
                            let failFlag = true;
                            let status = this.rwBuf.read_uint8();
                            switch(status){
                                case gConst.FLASH_STATUS_OK: {
                                    failFlag = false;
                                    this.binPage++;
                                    if(this.binPage < this.net.numPages){
                                        setTimeout(()=>{
                                            this.wrFlashPageReq();
                                        }, 0);
                                    }
                                    else {
                                        setTimeout(()=>{
                                            this.wrBinDone();
                                        }, 0);
                                    }
                                    break;
                                }
                                case gConst.FLASH_STATUS_INIT_FAIL: {
                                    this.utils.sendMsg("flash err: init fail", gConst.RED);
                                    break;
                                }
                                case gConst.FLASH_STATUS_ERASE_FAIL: {
                                    this.utils.sendMsg("flash err: erase fail", gConst.RED);
                                    break;
                                }
                                case gConst.FLASH_STATUS_PROG_FAIL: {
                                    this.utils.sendMsg("flash err: prog fail", gConst.RED);
                                    break;
                                }
                                case gConst.FLASH_STATUS_VERIFY_FAIL: {
                                    this.utils.sendMsg("flash err: verify fail", gConst.RED);
                                    break;
                                }
                                default: {
                                    this.utils.sendMsg("flash err: unsuported", gConst.RED);
                                    break;
                                }
                            }
                            if(failFlag == true){
                                this.wrBinFailed();
                            }
                            break;
                        }
                        case gConst.USB_CMD_READ_PART_NUM: {
                            this.partNum = this.rwBuf.read_uint32_LE();
                            this.utils.sendMsg(`part num: ${this.partNum}`, gConst.BLUE);
                            if(this.prevPartNum != this.partNum){
                                this.prevPartNum = this.partNum;
                                this.events.publish('new_part', this.partNum);
                            }
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
                this.utils.sendMsg(log_msg, gConst.ORANGE);
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
            this.utils.sendMsg(`send err: ${sendInfo.error}`, gConst.RED);
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
                    this.utils.sendMsg(`${this.portPath} lost`, gConst.RED);
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
     * fn          writeBin
     *
     * brief
     *
     */
    writeBin() {
        this.wrBinFlag = true;
        this.binPage = 0;
        setTimeout(() => {
            this.wrFlashPageReq();
        }, 0);
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
            this.rwBuf.write_uint8(this.net.bin_img[binIdx++]);
        }
        this.events.publish('bin_bar', ((this.binPage * 100) / this.net.numPages));

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
     * fn          wrBinDone
     *
     * brief
     *
     */
    wrBinDone() {

        this.wrBinFlag = false;

        const binInfo = {} as gIF.binInfo_t;
        binInfo.status = gConst.WR_OK;
        this.events.publish('bin_info', binInfo);
    }

    /***********************************************************************************************
     * fn          wrBinFailed
     *
     * brief
     *
     */
    wrBinFailed() {

        this.wrBinFlag = false;

        const binInfo = {} as gIF.binInfo_t;
        binInfo.status = gConst.WR_FAIL;
        this.events.publish('bin_info', binInfo);
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
     * fn          readBin
     *
     * brief
     *
     *
    readBin(path: string) {

        if(this.wrBinFlag == true){
            this.utils.sendMsg(`busy`, gConst.CHOCOLATE);
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
    */
    /***********************************************************************************************
     * fn          dlBin
     *
     * brief
     *
     *
    dlBin() {

        if(this.wrBinFlag == true){
            this.utils.sendMsg(`busy`, gConst.CHOCOLATE);
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
    */

}
