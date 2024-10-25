'use client';

import { SubmitButton } from "@/components/custom/submit-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FormUtils } from "@/lib/form.utilts";
import { AppSourceInfoInputModel, appSourceInfoInputZodModel } from "@/model/app-source-info.model";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useFormState } from "react-dom";
import { ServerActionResult } from "@/model/server-action-error-return.model";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { AppRateLimitsModel, appRateLimitsZodModel } from "@/model/app-rate-limits.model";
import { App } from "@prisma/client";
import { useEffect } from "react";
import { toast } from "sonner";
import { AppEnvVariablesModel, appEnvVariablesZodModel } from "@/model/env-edit.model";
import { Textarea } from "@/components/ui/textarea";
import { AppExtendedModel } from "@/model/app-extended.model";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckIcon, CrossIcon, DeleteIcon, EditIcon, TrashIcon, XIcon } from "lucide-react";
import DialogEditDialog from "./domain-edit.-overlay";
import { Toast } from "@/lib/toast.utils";
import { deleteDomain } from "./actions";


export default function DomainsList({ app }: {
    app: AppExtendedModel
}) {
    return <>
        <Card>
            <CardHeader>
                <CardTitle>Domains</CardTitle>
                <CardDescription>Add custom domains to your application. If your app has a domain configured, it will be public and accessible via the internet.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableCaption>{app.appDomains.length} Domains</TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Port</TableHead>
                            <TableHead>SSL</TableHead>
                            <TableHead className="w-[100px]">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {app.appDomains.map(domain => (
                            <TableRow key={domain.hostname}>
                                <TableCell className="font-medium">{domain.hostname}</TableCell>
                                <TableCell className="font-medium">{domain.port}</TableCell>
                                <TableCell className="font-medium">{domain.useSsl ? <CheckIcon /> : <XIcon />}</TableCell>
                                <TableCell className="font-medium flex gap-2">
                                    <DialogEditDialog appId={app.id} domain={domain}>
                                        <Button variant="ghost"><EditIcon /></Button>
                                    </DialogEditDialog>
                                    <Button variant="ghost" onClick={() => Toast.fromAction(() => deleteDomain(domain.id))}>
                                        <TrashIcon />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
            <CardFooter>
                <DialogEditDialog appId={app.id}>
                    <Button>Add Domain</Button>
                </DialogEditDialog>
            </CardFooter>
        </Card >

    </>;
}