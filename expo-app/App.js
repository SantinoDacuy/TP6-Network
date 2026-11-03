/* eslint-env browser */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  native,
  repo,
  sync,
  observeNetwork,
  discover,
  diagnoseSnmp,
  captureEvidence,
  readBarcode,
  saveInstallation,
  validateBackend,
  resolveUri,
  suggestedBackend,
  DEMO_TOKEN,
} from './src/services';

if (Platform.OS === 'web') {
  // react-native-web implementa Alert.alert como no-op: sin esto no se puede confirmar la huella SSH.
  Alert.alert = (title, message = '', buttons = []) => {
    const confirm = buttons.find(b => b.style !== 'cancel' && b.onPress);
    const text = message ? `${title}\n\n${message}` : title;
    if (!confirm) {
      window.alert(text);
    } else if (window.confirm(text)) {
      confirm.onPress();
    }
  };
}
const tabs = ['Red', 'Instalación', 'Historial', 'Cola', 'Ajustes'];
const timestamp = value => new Date(value).toLocaleString('es-AR');
const pretty = value => JSON.stringify(value, null, 2);
function Button({ children, onPress, disabled, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (disabled || pressed) && s.dim,
      ]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>
        {children}
      </Text>
    </Pressable>
  );
}
function Field({ label, ...props }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        placeholderTextColor="#8390a4"
        style={[s.input, props.multiline && s.multiline]}
        {...props}
      />
    </View>
  );
}
function Card({ children, selected = false }) {
  return <View style={[s.card, selected && s.selected]}>{children}</View>;
}
function Badge({ children, good = false }) {
  return <Text style={[s.badge, good && s.good]}>{children}</Text>;
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}
function Main() {
  const [state, setState] = useState(null),
    [tab, setTab] = useState('Red');
  const [selectedId, setSelectedId] = useState(null),
    [busy, setBusy] = useState(''),
    [status, setStatus] = useState('Listo para trabajar en campo');
  // Valores iniciales del equipo de laboratorio (lab/): community tp6lab, ifIndex 2 (eth0), SSH 2222.
  const [manualIp, setManualIp] = useState(''),
    [community, setCommunity] = useState('tp6lab'),
    [ifIndex, setIfIndex] = useState('2'),
    [snmpVersion, setSnmpVersion] = useState(1);
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [sshPort, setSshPort] = useState('2222'),
    [profile, setProfile] = useState('linux'),
    [fingerprint, setFingerprint] = useState('');
  const [site, setSite] = useState(''),
    [notes, setNotes] = useState(''),
    [technician, setTechnician] = useState(''),
    [photos, setPhotos] = useState([]);
  const [backendUrl, setBackendUrl] = useState(''),
    [token, setToken] = useState(''),
    [historyFilter, setHistoryFilter] = useState(''),
    [details, setDetails] = useState('');
  const [scanning, setScanning] = useState(false),
    [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const device = state?.devices.find(d => d.id === selectedId);
  const pending = state?.outbox.filter(j => j.status !== 'done').length || 0;
  useEffect(() => {
    if (!native) {
      setStatus(
        'El módulo FieldKit requiere la compilación nativa Android. Expo Go no es compatible.',
      );
      return;
    }
    let dispose = () => {},
      mounted = true;
    const unsubscribe = repo.subscribe(value => {
      if (mounted) {
        setState(value);
      }
    });
    repo
      .load()
      .then(value => {
        if (!mounted) {
          return;
        }
        setState(value);
        setBackendUrl(value.settings.backendUrl);
        if (value.settings.backendUrl === 'http://10.0.2.2:8787') {
          // Primera apertura en Expo Go: el PC que sirve el bundle también corre el gateway.
          const base = suggestedBackend();
          setBackendUrl(base);
          repo
            .update(next => {
              next.settings.backendUrl = base;
            })
            .catch(() => {});
        }
        native.getSecret('sync-token').then(saved => {
          if (!saved) {
            // Token público del laboratorio (README); se reemplaza desde Ajustes.
            native.setSecret('sync-token', DEMO_TOKEN).catch(() => {});
          }
        });
        const draft = value.draft || {};
        setSelectedId(draft.deviceId || null);
        setSite(draft.site || '');
        setNotes(draft.notes || '');
        setTechnician(draft.technician || '');
        setPhotos(draft.photos || []);
        dispose = observeNetwork();
        sync.run().catch(() => {});
      })
      .catch(error =>
        setStatus(`Error al abrir la base local: ${error.message}`),
      );
    const subscription = AppState.addEventListener('change', value => {
      if (value === 'active' && repo.state) {
        sync.run().catch(() => {});
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
      dispose();
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    setFingerprint('');
    setDetails('');
    setPassword('');
  }, [selectedId, sshPort]);
  useEffect(() => {
    if (repo.state) {
      persistDraft({ deviceId: selectedId }).catch(() => {});
    }
  }, [selectedId]);
  function persistDraft(patch) {
    return repo
      .update(next => {
        next.draft = { ...next.draft, ...patch };
      })
      .catch(error => {
        setStatus(`No se pudo guardar el borrador: ${error.message}`);
        throw error;
      });
  }
  async function action(label, task) {
    if (busy) {
      return;
    }
    setBusy(label);
    setStatus(label);
    try {
      await task();
    } catch (error) {
      setStatus(error.message || 'No se pudo completar la operación');
      Alert.alert('Revisá la operación', error.message || String(error));
    } finally {
      setBusy('');
    }
  }
  function choose(id) {
    if (photos.length && selectedId !== id) {
      Alert.alert(
        'Instalación en curso',
        'Guardá el reporte o quitá las fotos antes de cambiar de equipo.',
      );
      return;
    }
    setSelectedId(id);
  }
  async function scan() {
    const count = await discover();
    setStatus(
      `${count} equipos detectados. Seleccioná uno para consultar SNMP.`,
    );
    if (!selectedId && repo.state.devices.length) {
      setSelectedId(repo.state.devices[0].id);
    }
  }
  async function addManual() {
    if (
      !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(manualIp) ||
      manualIp.split('.').length !== 4 ||
      manualIp.split('.').some(n => !/^\d{1,3}$/.test(n) || +n > 255)
    ) {
      throw new Error('Ingresá una IPv4 privada válida');
    }
    await repo.addDevices([
      { ip: manualIp, source: 'Manual', lastSeen: new Date().toISOString() },
    ]);
    setSelectedId(repo.state.devices.find(d => d.ip === manualIp).id);
    setManualIp('');
    setStatus('Equipo agregado. Todavía no se verificó su conectividad.');
  }
  async function openScanner() {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    if (!permission.granted) {
      throw new Error(
        'Permiso de cámara denegado. Habilitalo en Ajustes para continuar.',
      );
    }
    setScanning(true);
  }
  function onScanned({ data }) {
    if (!scanning) {
      return;
    }
    setScanning(false);
    action('Buscando ficha técnica', async () => {
      const result = await readBarcode(device, data);
      setDetails(pretty(result));
      setStatus(result.message || 'Equipo asociado a su ficha técnica');
    });
  }
  async function trustSsh() {
    const port = Number(sshPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Puerto SSH inválido');
    }
    const pin = await native.sshFingerprint(device.ip, port);
    Alert.alert(
      'Verificar huella SSH',
      `${pin}\n\nCompará esta huella con la consola del equipo o una fuente confiable antes de guardarla.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Verifiqué la huella',
          onPress: () => {
            repo
              .update(next => {
                next.devices.find(d => d.id === device.id).sshPins = {
                  ...device.sshPins,
                  [port]: pin,
                };
              })
              .then(() => {
                setFingerprint(pin);
                setStatus('Huella SSH guardada para este puerto');
              })
              .catch(error => setStatus(error.message));
          },
        },
      ],
    );
  }
  const pin = device?.sshPins?.[Number(sshPort)] || fingerprint;
  const lastDiagnostic = state?.diagnostics.find(
    d => d.deviceId === selectedId,
  );
  const filteredReports =
    state?.installations.filter(report =>
      `${report.site} ${report.device.ip} ${report.device.hostname || ''}`
        .toLowerCase()
        .includes(historyFilter.toLowerCase()),
    ) || [];
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0b1422" />
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>FIELD OPERATIONS / TP6</Text>
            <Text style={s.brand}>
              Network<Text style={s.brandAccent}>/</Text>Kit
            </Text>
          </View>
          <View style={s.localPill}>
            <View style={s.dot} />
            <Text style={s.localText}>LOCAL FIRST</Text>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.tabs}
          contentContainerStyle={s.tabsContent}
        >
          {tabs.map(name => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === name }}
              key={name}
              style={[s.tab, tab === name && s.activeTab]}
              onPress={() => setTab(name)}
            >
              <Text style={[s.tabText, tab === name && s.activeTabText]}>
                {name}
                {name === 'Cola' && pending ? ` · ${pending}` : ''}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={s.status}>
          {busy ? (
            <ActivityIndicator size="small" color="#59e3be" />
          ) : (
            <View style={s.dot} />
          )}
          <Text style={s.statusText} accessibilityLiveRegion="polite">
            {status}
          </Text>
        </View>
        {!state ? (
          <View style={s.empty}>
            <Text style={s.heading}>Preparando el espacio local</Text>
            <Text style={s.muted}>
              Tus equipos, diagnósticos y reportes se guardan en este
              dispositivo.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {tab === 'Red' && (
              <>
                <Text style={s.pageTitle}>Tu red, a la vista.</Text>
                <Text style={s.muted}>
                  Descubrí equipos (IP, MAC, hostname) con barrido TCP + tabla
                  ARP del gateway de campo en el /24 local. La LAN funciona sin
                  Internet.
                </Text>
                <View style={s.stats}>
                  <View style={s.stat}>
                    <Text style={s.statValue}>{state.devices.length}</Text>
                    <Text style={s.small}>EQUIPOS LOCALES</Text>
                  </View>
                  <View style={s.stat}>
                    <Text style={s.statValue}>{state.diagnostics.length}</Text>
                    <Text style={s.small}>DIAGNÓSTICOS</Text>
                  </View>
                </View>
                <Button
                  disabled={!!busy}
                  onPress={() => action('Explorando la LAN…', scan)}
                >
                  Explorar red local
                </Button>
                <Card>
                  <Text style={s.heading}>Agregar por IP</Text>
                  <Field
                    label="IPv4 privada"
                    placeholder="192.168.1.1"
                    keyboardType="decimal-pad"
                    value={manualIp}
                    onChangeText={setManualIp}
                  />
                  <Button
                    secondary
                    disabled={!!busy || !manualIp}
                    onPress={() => action('Agregando equipo', addManual)}
                  >
                    Agregar equipo
                  </Button>
                </Card>
                <Text style={s.sectionLabel}>INVENTARIO DEL DISPOSITIVO</Text>
                {!state.devices.length && (
                  <Card>
                    <Text style={s.heading}>Aún no hay equipos</Text>
                    <Text style={s.muted}>
                      Conectate al Wi-Fi del sitio y explorá la red, o ingresá
                      la IP del equipo.
                    </Text>
                  </Card>
                )}
                {state.devices.map(item => (
                  <Pressable
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => choose(item.id)}
                  >
                    <Card selected={item.id === selectedId}>
                      <View style={s.row}>
                        <Text style={s.heading}>
                          {item.hostname || item.ip}
                        </Text>
                        <Badge good={item.id === selectedId}>
                          {item.id === selectedId
                            ? 'SELECCIONADO'
                            : item.source || 'LOCAL'}
                        </Badge>
                      </View>
                      <Text style={s.mono}>{item.ip}</Text>
                      <Text style={s.muted}>
                        MAC {item.mac || 'no disponible'}
                        {item.macSource ? ` · ${item.macSource}` : ''}
                      </Text>
                      {!!item.barcode && (
                        <Text style={s.muted}>Código: {item.barcode}</Text>
                      )}
                      <Text style={s.small}>
                        Registrado {timestamp(item.lastSeen)}
                      </Text>
                    </Card>
                  </Pressable>
                ))}
                {device && (
                  <>
                    <Card selected>
                      <Text style={s.heading}>
                        Diagnóstico SNMP · {device.ip}
                      </Text>
                      <Text style={s.muted}>
                        GetRequest UDP/161. La community se usa en memoria
                        durante la consulta y no se guarda. Equipo de
                        laboratorio: tp6lab · ifIndex 2.
                      </Text>
                      <Field
                        label="Community"
                        autoCorrect={false}
                        value={community}
                        onChangeText={value => setCommunity(value.trim())}
                      />
                      <View style={s.row}>
                        <View style={s.flex}>
                          <Field
                            label="ifIndex"
                            value={ifIndex}
                            keyboardType="number-pad"
                            onChangeText={setIfIndex}
                          />
                        </View>
                        <Button
                          secondary
                          onPress={() => setSnmpVersion(v => (v === 1 ? 0 : 1))}
                        >
                          SNMP {snmpVersion === 1 ? 'v2c' : 'v1'}
                        </Button>
                      </View>
                      <Button
                        disabled={!!busy}
                        onPress={() =>
                          action(
                            'Consultando SNMP y midiendo tráfico…',
                            async () => {
                              const result = await diagnoseSnmp(
                                device,
                                community,
                                Number(ifIndex),
                                snmpVersion,
                              );
                              setDetails(pretty(result));
                              setStatus(
                                'SNMP recibido y guardado sin conexión',
                              );
                            },
                          )
                        }
                      >
                        Consultar estado y tráfico
                      </Button>
                    </Card>
                    <Card>
                      <Text style={s.heading}>Acceso SSH</Text>
                      <Text style={s.muted}>
                        Comandos predefinidos vía gateway de campo. Las
                        credenciales se guardan en el Keychain del dispositivo.
                      </Text>
                      <Field
                        label="Puerto"
                        value={sshPort}
                        keyboardType="number-pad"
                        onChangeText={setSshPort}
                      />
                      <Field
                        label="Usuario"
                        value={username}
                        onChangeText={setUsername}
                      />
                      <Field
                        label="Contraseña"
                        secureTextEntry
                        value={password}
                        onChangeText={setPassword}
                      />
                      <View style={s.wrap}>
                        {['linux', 'routeros', 'cisco'].map(value => (
                          <Button
                            key={value}
                            secondary={profile !== value}
                            onPress={() => setProfile(value)}
                          >
                            {value}
                          </Button>
                        ))}
                      </View>
                      <Button
                        secondary
                        disabled={!!busy}
                        onPress={() =>
                          action('Leyendo clave pública SSH…', trustSsh)
                        }
                      >
                        Verificar huella del equipo
                      </Button>
                      {!!pin && <Text style={s.code}>{pin}</Text>}
                      <Button
                        secondary
                        disabled={!!busy || !username || !password}
                        onPress={() =>
                          action('Protegiendo credenciales', async () => {
                            if (
                              !Number.isInteger(Number(sshPort)) ||
                              +sshPort < 1 ||
                              +sshPort > 65535
                            ) {
                              throw new Error('Puerto inválido');
                            }
                            await native.setSecret(
                              `ssh:${device.ip}:${Number(sshPort)}`,
                              JSON.stringify({ username, password }),
                            );
                            setPassword('');
                            setStatus(
                              'Credenciales cifradas en el dispositivo',
                            );
                          })
                        }
                      >
                        Guardar credenciales
                      </Button>
                      <Button
                        disabled={!!busy || !pin}
                        onPress={() =>
                          action('Ejecutando diagnóstico SSH…', async () => {
                            const commands = JSON.parse(
                              await native.executeSsh(
                                device.ip,
                                Number(sshPort),
                                profile,
                                pin,
                              ),
                            );
                            const result = { profile, commands };
                            await repo.addDiagnostic(device.id, 'SSH', result);
                            setDetails(pretty(result));
                            setStatus('Salida SSH guardada localmente');
                          })
                        }
                      >
                        Ejecutar comandos
                      </Button>
                      <Button
                        secondary
                        disabled={!!busy}
                        onPress={() =>
                          action('Eliminando credenciales', async () => {
                            await native.setSecret(
                              `ssh:${device.ip}:${Number(sshPort)}`,
                              '',
                            );
                            setStatus('Credenciales del equipo eliminadas');
                          })
                        }
                      >
                        Eliminar credenciales
                      </Button>
                    </Card>
                    <Card>
                      <Text style={s.heading}>Identificar equipo</Text>
                      <Text style={s.muted}>
                        Apuntá la cámara a un QR o código de barras. La lectura
                        funciona offline; las fichas consultadas quedan en
                        caché.
                      </Text>
                      <Button
                        secondary
                        disabled={!!busy}
                        onPress={() => action('Abriendo cámara', openScanner)}
                      >
                        Leer QR / código de barras
                      </Button>
                    </Card>
                    {(details || lastDiagnostic) && (
                      <Card>
                        <Text style={s.heading}>Resultado local</Text>
                        <Text selectable style={s.code}>
                          {details || pretty(lastDiagnostic.result)}
                        </Text>
                      </Card>
                    )}
                  </>
                )}
              </>
            )}
            {tab === 'Instalación' && (
              <>
                <Text style={s.pageTitle}>Dejá todo documentado.</Text>
                <Text style={s.muted}>
                  Fotos con GPS, notas y diagnósticos en un reporte PDF guardado
                  localmente.
                </Text>
                <Card selected>
                  <Text style={s.label}>EQUIPO SELECCIONADO</Text>
                  <Text style={s.heading}>
                    {device
                      ? `${device.hostname || device.ip} · ${device.ip}`
                      : 'Seleccioná un equipo en Red'}
                  </Text>
                </Card>
                <Card>
                  <Field
                    label="Sitio de instalación"
                    placeholder="Edificio / gabinete / domicilio"
                    value={site}
                    onChangeText={value => {
                      setSite(value);
                      persistDraft({ site: value }).catch(() => {});
                    }}
                    maxLength={200}
                  />
                  <Field
                    label="Técnico"
                    placeholder="Tu nombre"
                    value={technician}
                    onChangeText={value => {
                      setTechnician(value);
                      persistDraft({ technician: value }).catch(() => {});
                    }}
                  />
                  <Field
                    label="Notas técnicas"
                    placeholder="Trabajo realizado, mediciones y observaciones"
                    value={notes}
                    onChangeText={value => {
                      setNotes(value);
                      persistDraft({ notes: value }).catch(() => {});
                    }}
                    multiline
                    maxLength={20000}
                  />
                  <Button
                    secondary
                    disabled={!!busy || !device || photos.length >= 20}
                    onPress={() =>
                      action('Capturando evidencia y GPS…', async () => {
                        const photo = await captureEvidence();
                        const updated = [...photos, photo];
                        await persistDraft({ photos: updated });
                        setPhotos(updated);
                        setStatus('Foto con ubicación agregada al borrador');
                      })
                    }
                  >
                    Agregar foto con GPS · {photos.length}/20
                  </Button>
                  <Text style={s.small}>
                    El borrador se guarda en este dispositivo y se recupera al
                    abrir la app. La ubicación incluye precisión y hora de
                    captura.
                  </Text>
                </Card>
                {photos.map((photo, index) => (
                  <Card key={photo.fileId}>
                    <Image
                      source={{ uri: resolveUri(photo.uri) }}
                      style={s.photo}
                      resizeMode="cover"
                    />
                    <Text style={s.muted}>
                      Foto {index + 1} · {photo.location.latitude.toFixed(6)},{' '}
                      {photo.location.longitude.toFixed(6)} · ±
                      {Math.round(photo.location.accuracy)} m
                    </Text>
                    <Button
                      secondary
                      disabled={!!busy}
                      onPress={() =>
                        action('Actualizando borrador', async () => {
                          const updated = photos.filter(
                            p => p.fileId !== photo.fileId,
                          );
                          await persistDraft({ photos: updated });
                          setPhotos(updated);
                        })
                      }
                    >
                      Quitar del borrador
                    </Button>
                  </Card>
                ))}
                <Button
                  disabled={!!busy || !device || !site.trim() || !photos.length}
                  onPress={() =>
                    action(
                      'Generando PDF y guardando instalación…',
                      async () => {
                        const report = await saveInstallation({
                          device,
                          site,
                          notes,
                          technician,
                          photos,
                        });
                        setPhotos([]);
                        setSite('');
                        setNotes('');
                        setTab('Historial');
                        setStatus(`Reporte ${report.id} guardado y encolado`);
                      },
                    )
                  }
                >
                  Guardar instalación y generar PDF
                </Button>
              </>
            )}
            {tab === 'Historial' && (
              <>
                <Text style={s.pageTitle}>El trabajo queda.</Text>
                <Text style={s.muted}>
                  Consultá reportes y diagnósticos sin conexión.
                </Text>
                <Field
                  label="Buscar por sitio o equipo"
                  value={historyFilter}
                  onChangeText={setHistoryFilter}
                  placeholder="Sitio, IP o nombre"
                />
                {!filteredReports.length && (
                  <Card>
                    <Text style={s.muted}>
                      No hay reportes para esta búsqueda.
                    </Text>
                  </Card>
                )}
                {filteredReports.map(report => (
                  <Card key={report.id}>
                    <Text style={s.heading}>{report.site}</Text>
                    <Text style={s.mono}>
                      {report.device.hostname || report.device.ip} ·{' '}
                      {report.device.ip}
                    </Text>
                    <Text style={s.small}>
                      {timestamp(report.createdAt)} · {report.photos.length}{' '}
                      foto(s)
                    </Text>
                    <Text style={s.muted}>
                      {report.notes || 'Sin notas adicionales'}
                    </Text>
                    <Badge
                      good={
                        state.outbox.find(j => j.installationId === report.id)
                          ?.status === 'done'
                      }
                    >
                      {state.outbox.find(j => j.installationId === report.id)
                        ?.status === 'done'
                        ? 'SINCRONIZADO'
                        : 'GUARDADO LOCAL'}
                    </Badge>
                    <Button
                      secondary
                      disabled={!!busy}
                      onPress={() =>
                        action('Abriendo reporte PDF', async () => {
                          await native.shareFile(report.pdf.uri);
                          setStatus('Reporte disponible para compartir');
                        })
                      }
                    >
                      Ver / compartir PDF
                    </Button>
                  </Card>
                ))}
                <Text style={s.sectionLabel}>DIAGNÓSTICOS POR EQUIPO</Text>
                {state.diagnostics
                  .filter(d => {
                    const target = state.devices.find(e => e.id === d.deviceId);
                    return (
                      !historyFilter ||
                      `${target?.ip} ${target?.hostname}`
                        .toLowerCase()
                        .includes(historyFilter.toLowerCase())
                    );
                  })
                  .map(d => (
                    <Card key={d.id}>
                      <Text style={s.heading}>
                        {d.protocol} ·{' '}
                        {state.devices.find(e => e.id === d.deviceId)?.ip ||
                          'Equipo'}
                      </Text>
                      <Text style={s.small}>{timestamp(d.createdAt)}</Text>
                      <Text selectable style={s.code}>
                        {pretty(d.result)}
                      </Text>
                    </Card>
                  ))}
              </>
            )}
            {tab === 'Cola' && (
              <>
                <Text style={s.pageTitle}>Guardá hoy. Sincronizá después.</Text>
                <Text style={s.muted}>
                  Cada reporte tiene un ID estable. Los reintentos suben la
                  evidencia y esperan confirmación del backend.
                </Text>
                <Button
                  disabled={!!busy}
                  onPress={() =>
                    action('Sincronizando reportes pendientes…', async () => {
                      await sync.run(true);
                      const remaining = repo.state.outbox.filter(
                        j => j.status !== 'done',
                      ).length;
                      setStatus(
                        remaining
                          ? `${remaining} reportes pendientes. Revisá el detalle de la cola.`
                          : 'Todos los reportes están sincronizados',
                      );
                    })
                  }
                >
                  Sincronizar ahora
                </Button>
                {!state.outbox.length && (
                  <Card>
                    <Text style={s.muted}>
                      La cola está vacía. Los reportes se agregan al guardar una
                      instalación.
                    </Text>
                  </Card>
                )}
                {state.outbox.map(job => (
                  <Card key={job.id}>
                    <View style={s.row}>
                      <Text style={s.heading}>
                        {
                          state.installations.find(
                            i => i.id === job.installationId,
                          )?.site
                        }
                      </Text>
                      <Badge good={job.status === 'done'}>
                        {
                          {
                            pending: 'PENDIENTE',
                            sending: 'ENVIANDO',
                            failed: 'REINTENTO',
                            done: 'ENVIADO',
                          }[job.status]
                        }
                      </Badge>
                    </View>
                    <Text style={s.small}>
                      Intentos fallidos: {job.attempts} ·{' '}
                      {timestamp(job.createdAt)}
                    </Text>
                    {!!job.error && <Text style={s.error}>{job.error}</Text>}
                    {job.nextAt > 0 && job.status !== 'done' && (
                      <Text style={s.muted}>
                        Próximo intento: {timestamp(job.nextAt)}
                      </Text>
                    )}
                    <Text style={s.code}>{job.id}</Text>
                  </Card>
                ))}
              </>
            )}
            {tab === 'Ajustes' && (
              <>
                <Text style={s.pageTitle}>Tu base de operaciones.</Text>
                <Text style={s.muted}>
                  Configurá el backend del laboratorio. El token se guarda
                  cifrado y no se incluye en los reportes.
                </Text>
                <Card>
                  <Field
                    label="URL del backend"
                    placeholder="http://192.168.1.10:8787"
                    value={backendUrl}
                    onChangeText={setBackendUrl}
                    autoCorrect={false}
                  />
                  <Field
                    label="Token (vacío para conservar el guardado)"
                    value={token}
                    secureTextEntry
                    onChangeText={setToken}
                  />
                  <Button
                    disabled={!!busy}
                    onPress={() =>
                      action('Guardando configuración', async () => {
                        const base = validateBackend(backendUrl);
                        if (token && token.length < 16) {
                          throw new Error(
                            'El token debe tener al menos 16 caracteres',
                          );
                        }
                        if (token) {
                          await native.setSecret('sync-token', token);
                        }
                        await repo.update(next => {
                          next.settings.backendUrl = base;
                        });
                        setToken('');
                        setStatus('Configuración guardada');
                        sync.run(true).catch(() => {});
                      })
                    }
                  >
                    Guardar configuración
                  </Button>
                  <Button
                    secondary
                    disabled={!!busy}
                    onPress={() =>
                      action('Consultando red local', async () => {
                        const info = JSON.parse(await native.networkInfo());
                        setStatus(
                          `IPv4 local ${info.ip} · exploración ${info.prefix}.0/24`,
                        );
                      })
                    }
                  >
                    Ver IP del teléfono
                  </Button>
                </Card>
                <Card>
                  <Text style={s.heading}>Alcance de esta entrega</Text>
                  <Text style={s.muted}>
                    Expo Go (SDK 58) · iOS, Android y web{'\n'}SNMP v1/v2c con
                    codec BER propio · SSH con huella verificada{'\n'}Gateway de
                    campo para UDP/161, barrido LAN + ARP y SSH{'\n'}SQLite
                    transaccional · outbox persistente{'\n'}PDF propio con fotos
                    y GPS · fichas en caché
                  </Text>
                  <Text style={s.small}>
                    La sincronización automática se ejecuta mientras la app está
                    activa y al volver a abrirla. No requiere Internet si el
                    backend está en la LAN.
                  </Text>
                </Card>
              </>
            )}
            <Text style={s.footer}>NETWORK DIAGNOSTICS SUITE / 2026</Text>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <Modal
        visible={scanning}
        animationType="slide"
        onRequestClose={() => setScanning(false)}
      >
        <View style={s.scanner}>
          {scanning && (
            <CameraView
              style={s.flex}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: [
                  'qr',
                  'ean13',
                  'ean8',
                  'code128',
                  'code39',
                  'datamatrix',
                  'upc_a',
                ],
              }}
              onBarcodeScanned={onScanned}
            />
          )}
          <View style={s.scannerBar}>
            <Text style={s.muted}>
              Encuadrá el QR o código de barras del equipo
            </Text>
            <Button secondary onPress={() => setScanning(false)}>
              Cancelar
            </Button>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b1422' },
  scanner: { flex: 1, backgroundColor: '#000' },
  scannerBar: { padding: 18, gap: 10, backgroundColor: '#0b1422' },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 22,
    paddingTop: 17,
    paddingBottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 2.2,
    color: '#90a2ba',
    fontWeight: '700',
    marginBottom: 6,
  },
  brand: {
    fontSize: 30,
    fontWeight: '800',
    color: '#f5f7fb',
    letterSpacing: -1.5,
  },
  brandAccent: { color: '#59e3be' },
  localPill: {
    padding: 9,
    borderRadius: 16,
    backgroundColor: '#17362f',
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  localText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: '#59e3be',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#59e3be' },
  tabs: { flexGrow: 0, flexShrink: 0, height: 48 },
  tabsContent: { paddingHorizontal: 18, gap: 7, paddingBottom: 9 },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: '#141f30',
  },
  activeTab: { backgroundColor: '#59e3be' },
  tabText: { color: '#a5b4c8', fontWeight: '700', fontSize: 12 },
  activeTabText: { color: '#092219' },
  status: {
    paddingHorizontal: 23,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#1d2b3e',
  },
  statusText: { color: '#b7c6d8', fontSize: 11, flex: 1, lineHeight: 16 },
  content: { padding: 20, gap: 15, paddingBottom: 36 },
  pageTitle: {
    fontSize: 29,
    lineHeight: 35,
    color: '#f5f7fb',
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 8,
  },
  muted: { fontSize: 12, lineHeight: 20, color: '#9baec7' },
  small: { fontSize: 10, lineHeight: 16, color: '#8a9bb0' },
  stats: { flexDirection: 'row', gap: 12 },
  stat: {
    flex: 1,
    borderTopWidth: 1,
    borderColor: '#2b3b50',
    paddingVertical: 13,
  },
  statValue: {
    color: '#59e3be',
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 5,
  },
  card: {
    padding: 17,
    borderRadius: 15,
    backgroundColor: '#121f31',
    borderWidth: 1,
    borderColor: '#23334a',
    gap: 10,
  },
  selected: { borderColor: '#3ba88b', backgroundColor: '#132a30' },
  heading: {
    color: '#eaf0f8',
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
    lineHeight: 21,
  },
  sectionLabel: {
    color: '#8ca0b9',
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: 10,
    fontWeight: '700',
  },
  field: { gap: 7, marginVertical: 3 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  label: { color: '#b8c8da', fontSize: 11, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#30425c',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#f0f5fc',
    fontSize: 13,
    backgroundColor: '#0c1727',
  },
  button: {
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: 9,
    backgroundColor: '#59e3be',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 43,
  },
  buttonText: { color: '#0c2b23', fontSize: 12, fontWeight: '800' },
  secondary: {
    backgroundColor: '#1c3046',
    borderWidth: 1,
    borderColor: '#354c66',
  },
  secondaryText: { color: '#d5e6f7' },
  dim: { opacity: 0.45 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'space-between',
  },
  wrap: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  badge: {
    color: '#b4c4d7',
    backgroundColor: '#24364b',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 8,
    fontWeight: '800',
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  good: { color: '#73efc9', backgroundColor: '#1c473d' },
  mono: { fontFamily: 'monospace', color: '#c5d6eb', fontSize: 12 },
  code: {
    fontFamily: 'monospace',
    color: '#a8c9d6',
    fontSize: 10,
    lineHeight: 16,
  },
  photo: { width: '100%', height: 210, borderRadius: 9 },
  error: { color: '#ffb9a5', fontSize: 12, lineHeight: 18 },
  footer: {
    color: '#61758f',
    fontSize: 8,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 22,
  },
  empty: { padding: 24, gap: 15 },
});
