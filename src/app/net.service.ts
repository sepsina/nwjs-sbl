import { Injectable } from '@angular/core';
import { EventsService } from './events.service';
import { UtilsService } from './utils.service';

import * as gIF from './gIF';
import * as gConst from './gConst';

//const HOST = '192.168.1.217'; // Server hostname (or IP)
const HOST = '77.37.96.83'; // Server hostname (or IP)
const PORT = 10167; // Port to connect to

@Injectable({
    providedIn: 'root',
})
export class NetService {

    txBuf = new Uint8Array(1024);
    rwBuf = new gIF.rwBuf_t();

    numPages = 0;

    bin_img = new Uint8Array(256*1024);
    bin_file = '';
    bin_size = 0;
    img_idx = 0;

    busy_flag = false;

    dgram: any;
    udpSocket: any;
    udpTmo: any;
    retryTmo: any;

    crypto: any;

    trash = 0;

    constructor(
        private events: EventsService,
        private utils: UtilsService
    ){
        this.rwBuf.wrBuf = new DataView(this.txBuf.buffer);
        this.dgram = window.nw.require('dgram');
        this.udpSocket = new this.dgram.createSocket('udp4');
        this.udpSocket.on('message', (msg: Uint8Array, rinfo: gIF.rinfo_t)=>{
            this.udpOnMsg(msg, rinfo);
        });
        this.udpSocket.on('error', (err: any)=>{
            console.log(`server error:\n${err.stack}`);
        });
        this.udpSocket.on('listening', ()=>{
            let address = this.udpSocket.address();
            console.log(`server listening ${address.address}:${address.port}`);
        });
        this.udpSocket.bind(PORT);

        this.crypto = window.nw.require('crypto');

    }

    /***********************************************************************************************
     * fn          dl_bin
     *
     * brief
     *
     */
    dl_bin(){

        this.numPages = 0;
        this.img_idx = 0;
        this.busy_flag = true;

        this.getSize();
    }

    /***********************************************************************************************
     * fn          udpOnMsg
     *
     * brief
     *
     */
    udpOnMsg(msg: Uint8Array, rem: gIF.rinfo_t) {

        clearTimeout(this.retryTmo);
        clearTimeout(this.udpTmo);

        this.rwBuf.rdBuf = new DataView(msg.buffer);
        this.rwBuf.rdIdx = 0;
        const cmd_id = this.rwBuf.read_uint8();
        switch(cmd_id){
            case gConst.GET_SIZE: {
                this.bin_size = this.rwBuf.read_uint32_LE();
                if(this.bin_size == 0){
                    console.log('not valid part');
                    this.busy_flag = false;
                    const binInfo = {} as gIF.binInfo_t;
                    binInfo.status = gConst.DL_NO_PART
                    this.events.publish('bin_info', binInfo);
                }
                else {
                    this.bin_file = '';
                    let chr = 0;
                    do {
                        chr = this.rwBuf.read_uint8();
                        if(chr){
                            this.bin_file += String.fromCharCode(chr);
                        }
                    } while(chr != 0);

                    this.getPage(rem);
                }
                break;
            }
            case gConst.GET_PAGE: {
                const start_idx = this.rwBuf.read_uint32_LE();
                if(start_idx == this.img_idx){
                    const len = msg.byteLength;
                    do {
                        this.bin_img[this.img_idx++] = this.rwBuf.read_uint8();
                    } while(this.rwBuf.rdIdx < len);
                    if(this.img_idx < this.bin_size){
                        this.getPage(rem);
                    }
                    else {
                        this.busy_flag = false;
                        const binInfo = {} as gIF.binInfo_t;
                        const shaFlag = this.checkSHA();
                        if(shaFlag == true){
                            this.numPages = Math.floor(this.bin_size / gConst.PAGE_SIZE);
                            binInfo.status = gConst.DL_OK;
                            binInfo.size = this.bin_size;
                            binInfo.file = this.bin_file;
                        }
                        else {
                            binInfo.status = gConst.DL_SHA_NOT_VALID;
                        }
                        this.events.publish('bin_info', binInfo);
                    }
                }
                else {
                    this.getPage(rem);
                }
                break;
            }
        }
    }

    /***********************************************************************************************
     * fn          getSize
     *
     * brief
     *
     */
    getSize(){

        this.rwBuf.wrIdx = 0;
        this.rwBuf.write_uint8(gConst.GET_SIZE);
        //this.rwBuf.write_uint32_LE(this.serial.partNum);
        this.rwBuf.write_uint32_LE(gConst.SSR_900); // *** test ***

        const rem = {} as gIF.rinfo_t;
        rem.port = PORT;
        rem.address = HOST;
        this.udpSend(rem);
    }

    /***********************************************************************************************
     * fn          getPage
     *
     * brief
     *
     */
    getPage(rem: gIF.rinfo_t){

        this.rwBuf.wrIdx = 0;
        this.rwBuf.write_uint8(gConst.GET_PAGE);
        //this.rwBuf.write_uint32_LE(this.serial.partNum);
        this.rwBuf.write_uint32_LE(gConst.SSR_900); // *** test ***
        this.rwBuf.write_uint32_LE(this.img_idx);

        this.udpSend(rem);
        this.events.publish('bin_bar', ((this.img_idx * 100) / this.bin_size));
    }

    /***********************************************************************************************
     * fn          shaCheck
     *
     * brief
     *
     */
    checkSHA(){

        const hash = this.crypto.createHash('sha256');
        let len = this.bin_size - 32;
        hash.update(this.bin_img.subarray(0, len));
        const sha: Uint8Array = hash.digest();
        let valid_sha = true;
        for(let i = 0; i < 32; i++){
            if(this.bin_img[len++] != sha[i]){
                valid_sha = false;
                break;
            }
        }
        console.log(`sha valid: ${valid_sha}`);
        return valid_sha;
    }

    /***********************************************************************************************
     * fn          udpSend
     *
     * brief
     *
     */
    udpSend(rem: gIF.rinfo_t){

        const tcp_msg = this.txBuf.slice(0, this.rwBuf.wrIdx);

        setTimeout(()=>{
            this.udpSocket.send(tcp_msg, rem.port, rem.address, (err: any)=>{
                if(err){
                    console.log(`send err: ${err}`);
                }
            });
        }, 0);
        this.retryTmo = setTimeout(()=>{
            this.udpSocket.send(tcp_msg, rem.port, rem.address, (err: any)=>{
                if(err){
                    console.log(`send err: ${err}`);
                }
            });
        }, 500);
        this.udpTmo = setTimeout(()=>{
            this.busy_flag = false;
            const binInfo = {} as gIF.binInfo_t;
            binInfo.status = gConst.DL_FAIL
            this.events.publish('bin_info', binInfo);
        }, 2000);
    }
}
