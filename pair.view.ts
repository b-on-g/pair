namespace $.$$ {

	const qr_module = require( 'jsqr/dist/jsQR.js' ) as Qr_read & { default?: Qr_read }
	const qr_read = qr_module.default ?? qr_module
	type Qr_read = typeof import(
		'jsqr'
	).default

	const prefix = 'BP1'

	type Ndef_record = { recordType: string, encoding?: string, data: DataView }
	type Ndef_reader = {
		write( text: string ): Promise< void >
		scan(): Promise< void >
		onreading: ( event: { message: { records: Ndef_record[] } } )=> void
	}

	async function sdp_pack( kind: 'o' | 'a', sdp: string ) {
		const stream = new Blob([ sdp ]).stream().pipeThrough( new CompressionStream( 'deflate-raw' ) )
		const bin = new Uint8Array( await new Response( stream ).arrayBuffer() )
		return prefix + kind + $mol_base64_url_encode( bin )
	}

	async function sdp_unpack( code: string ) {
		if( !code.startsWith( prefix ) ) throw new Error( 'Это не код пары' )
		const kind = code[ prefix.length ]
		if( kind !== 'o' && kind !== 'a' ) throw new Error( 'Неизвестный вид кода' )
		const bin = $mol_base64_url_decode( code.slice( prefix.length + 1 ) )
		const stream = new Blob([ bin ]).stream().pipeThrough( new DecompressionStream( 'deflate-raw' ) )
		const sdp = await new Response( stream ).text()
		return { kind, sdp } as const
	}

	export class $bog_pair extends $.$bog_pair {

		rtc = null as RTCPeerConnection | null
		channel = null as RTCDataChannel | null

		@ $mol_mem
		status( next = 'Первое устройство: «Пригласить». Второе: «Сканировать QR» или вставить код.' ) {
			return next
		}

		@ $mol_mem
		code_out( next = '' ) {
			return next
		}

		@ $mol_mem
		code_label( next = '' ) {
			return next
		}

		@ $mol_mem
		opened( next = false ) {
			return next
		}

		@ $mol_mem
		messages( next = [] as string[] ) {
			return next
		}

		@ $mol_mem
		log( next = [] as string[] ) {
			return next
		}

		nfc_supported() {
			return 'NDEFReader' in globalThis
		}

		nfc_reader() {
			const Reader = ( globalThis as unknown as { NDEFReader: new()=> Ndef_reader } ).NDEFReader
			return new Reader
		}

		body() {
			return [
				this.Status(),
				this.Actions(),
				... this.scanning() ? [ this.Camera() ] : [],
				... this.code_out() ? [ this.Code_block() ] : [],
				this.Paste_block(),
				... this.opened() ? [ this.Chat() ] : [],
				this.Messages(),
				this.Log_title(),
				this.Log(),
			]
		}

		actions() {
			return [
				this.Invite(),
				this.Scan(),
				... this.nfc_supported() ? [ this.Nfc_read() ] : [],
				this.Stun(),
			]
		}

		code_tools() {
			return [
				this.Code_copy(),
				... this.nfc_supported() ? [ this.Nfc_write() ] : [],
			]
		}

		message_rows() {
			return this.messages().map( ( _, index )=> this.Message( index ) )
		}

		message( index: number ) {
			return this.messages()[ index ]
		}

		log_rows() {
			return this.log().map( ( _, index )=> this.Log_line( index ) )
		}

		log_line( index: number ) {
			return this.log()[ index ]
		}

		note( text: string ) {
			const time = new Date().toLocaleTimeString()
			this.log([ `${ time } ${ text }`, ... this.log() ])
		}

		fail( error: unknown ) {
			const message = error instanceof Error ? error.message : String( error )
			this.note( 'ошибка: ' + message )
			this.status( 'Ошибка: ' + message )
		}

		candidate_brief( line: string ) {
			const parts = line.split( ' ' )
			const type = parts[ parts.indexOf( 'typ' ) + 1 ]
			const address = parts[ 4 ]
			const family = address.endsWith( '.local' ) ? 'mdns' : address.includes( ':' ) ? 'ipv6' : 'ipv4'
			return `${ type } ${ parts[ 2 ] } ${ family } ${ address }:${ parts[ 5 ] }`
		}

		sdp_candidates( sdp = '' ) {
			return sdp.split( /\r?\n/ )
				.filter( line => line.startsWith( 'a=candidate:' ) )
				.map( line => line.slice( 2 ) )
		}

		sdp_note( who: string, sdp = '' ) {
			const candidates = this.sdp_candidates( sdp )
			if( !candidates.length ) return this.note( `${ who }: адресов нет` )
			for( const line of candidates ) this.note( `${ who }: ${ this.candidate_brief( line ) }` )
		}

		async media_unlock() {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ video: true })
				stream.getTracks().forEach( track => track.stop() )
				this.note( 'камера разрешена: видны все сети' )
			} catch( error ) {
				this.note( 'камера не разрешена: виден только основной адрес' )
			}
		}

		rtc_make() {
			this.rtc?.close()
			const rtc = new RTCPeerConnection({
				iceServers: this.stun() ? [ { urls: 'stun:stun.l.google.com:19302' } ] : [],
			})
			rtc.onicecandidate = event => {
				if( event.candidate?.candidate ) this.note( 'кандидат: ' + this.candidate_brief( event.candidate.candidate ) )
			}
			rtc.oniceconnectionstatechange = ()=> this.note( 'ICE: ' + rtc.iceConnectionState )
			rtc.onconnectionstatechange = ()=> {
				this.note( 'связь: ' + rtc.connectionState )
				if( rtc.connectionState === 'failed' ) this.status( 'Не соединилось. Журнал внизу покажет, какие адреса нашлись.' )
			}
			rtc.ondatachannel = event => this.channel_bind( event.channel )
			this.rtc = rtc
			return rtc
		}

		gather( rtc: RTCPeerConnection ) {
			return new Promise< void >( done => {
				if( rtc.iceGatheringState === 'complete' ) return done()
				const timer = setTimeout( done, 5000 )
				rtc.onicegatheringstatechange = ()=> {
					if( rtc.iceGatheringState !== 'complete' ) return
					clearTimeout( timer )
					done()
				}
			} )
		}

		code_show( label: string, code: string ) {
			this.code_label( label )
			this.code_out( code )
			this.note( `код готов, ${ code.length } символов` )
		}

		channel_bind( channel: RTCDataChannel ) {
			this.channel = channel
			channel.onopen = ()=> {
				this.opened( true )
				this.code_out( '' )
				this.status( 'Соединено!' )
				this.note( 'канал открыт' )
				channel.send( 'привет от ' + navigator.userAgent )
				this.route_report().catch( error => this.fail( error ) )
			}
			channel.onmessage = event => this.messages([ ... this.messages(), '← ' + event.data ])
			channel.onclose = ()=> {
				this.opened( false )
				this.status( 'Канал закрыт' )
				this.note( 'канал закрыт' )
			}
		}

		async route_report() {
			const stats = await this.rtc!.getStats()
			const reports = [ ... stats.values() ] as Array< Record< string, any > >
			const pair = reports.find( report => report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded' )
			if( !pair ) return this.note( 'маршрут не найден в статистике' )
			const side = ( id: string, sdp = '' )=> {
				const report = stats.get( id )
				const port = String( report?.port ?? '' )
				const line = this.sdp_candidates( sdp ).find( line => line.split( ' ' )[ 5 ] === port )
				if( line ) return this.candidate_brief( line )
				return `${ report?.candidateType } ${ report?.protocol } ${ report?.address ?? report?.ip ?? '?' }:${ port }`
			}
			const rtc = this.rtc!
			const route = `${ side( pair.localCandidateId, rtc.localDescription?.sdp ) } ⇄ ${ side( pair.remoteCandidateId, rtc.remoteDescription?.sdp ) }`
			this.note( 'маршрут: ' + route )
			this.status( 'Соединено: ' + route )
		}

		async invite_run() {
			await this.media_unlock()
			const rtc = this.rtc_make()
			this.channel_bind( rtc.createDataChannel( 'pair' ) )
			await rtc.setLocalDescription( await rtc.createOffer() )
			await this.gather( rtc )
			this.code_show( 'Приглашение: покажи этот QR второму устройству', await sdp_pack( 'o', rtc.localDescription!.sdp ) )
			this.status( 'Теперь отсканируй ответный QR второго устройства' )
		}

		invite() {
			this.invite_run().catch( error => this.fail( error ) )
		}

		async accept_run( code: string ) {
			const { kind, sdp } = await sdp_unpack( code.trim() )
			this.sdp_note( 'сосед', sdp )
			if( kind === 'o' ) {
				this.note( 'принято приглашение' )
				await this.media_unlock()
				const rtc = this.rtc_make()
				await rtc.setRemoteDescription({ type: 'offer', sdp })
				await rtc.setLocalDescription( await rtc.createAnswer() )
				await this.gather( rtc )
				this.code_show( 'Ответ: покажи этот QR первому устройству', await sdp_pack( 'a', rtc.localDescription!.sdp ) )
				this.status( 'Жду, пока первое устройство отсканирует ответ' )
			} else {
				this.note( 'принят ответ' )
				if( this.rtc?.signalingState !== 'have-local-offer' ) throw new Error( 'Сначала нажми «Пригласить» на этом устройстве' )
				await this.rtc.setRemoteDescription({ type: 'answer', sdp })
				this.status( 'Соединяюсь…' )
			}
		}

		accept( code: string ) {
			this.accept_run( code ).catch( error => this.fail( error ) )
		}

		paste_accept() {
			const code = this.paste()
			this.paste( '' )
			this.accept( code )
		}

		@ $mol_mem
		scan_canvas() {
			return $mol_dom_context.document.createElement( 'canvas' )
		}

		@ $mol_mem
		scan_tick() {
			if( !this.scanning() ) return null
			$mol_state_time.now( 250 )
			const video = this.Camera().dom_node() as HTMLVideoElement
			const width = video.videoWidth
			const height = video.videoHeight
			if( !width || !height ) return null
			const canvas = this.scan_canvas()
			canvas.width = width
			canvas.height = height
			const context = canvas.getContext( '2d', { willReadFrequently: true } )!
			context.drawImage( video, 0, 0, width, height )
			const found = qr_read( context.getImageData( 0, 0, width, height ).data, width, height )
			if( !found?.data.startsWith( prefix ) ) return null
			setTimeout( ()=> {
				this.scanning( false )
				this.accept( found.data )
			} )
			return found.data
		}

		auto() {
			this.scan_tick()
		}

		nfc_write() {
			this.nfc_reader().write( this.code_out() )
				.then( ()=> this.note( 'код записан на метку' ) )
				.catch( error => this.fail( error ) )
		}

		nfc_read() {
			const reader = this.nfc_reader()
			reader.onreading = event => {
				for( const record of event.message.records ) {
					if( record.recordType !== 'text' ) continue
					const text = new TextDecoder( record.encoding ).decode( record.data )
					if( text.startsWith( prefix ) ) return this.accept( text )
				}
			}
			reader.scan()
				.then( ()=> this.note( 'поднеси метку к телефону' ) )
				.catch( error => this.fail( error ) )
		}

		send() {
			const text = this.draft()
			if( !text || !this.channel ) return
			this.channel.send( text )
			this.messages([ ... this.messages(), '→ ' + text ])
			this.draft( '' )
		}

		reset() {
			this.rtc?.close()
			this.rtc = null
			this.channel = null
			this.opened( false )
			this.scanning( false )
			this.code_out( '' )
			this.messages( [] )
			this.log( [] )
			this.status( 'Первое устройство: «Пригласить». Второе: «Сканировать QR» или вставить код.' )
		}

	}

}
